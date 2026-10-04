import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import {
  getClientIp,
  isIpAllowed,
  verifyOperatorToken,
  OperatorIdentity,
} from '../auth/access-control';
import { CamerasService } from '../cameras/cameras.service';
import { AlertsService } from '../alerts.service';
import { Inject, forwardRef } from '@nestjs/common';

const ipConnections = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 5;

interface ClientRateLimit {
  messageCount: number;
  lastReset: number;
}
const clientRateLimits = new Map<WebSocket, ClientRateLimit>();
const clientOperators = new Map<WebSocket, OperatorIdentity>();
const MAX_MESSAGES_PER_SECOND = 10;

const clientIps = new Map<WebSocket, string>();

@WebSocketGateway()
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly camerasService: CamerasService,
    @Inject(forwardRef(() => AlertsService))
    private readonly alertsService: AlertsService,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    const ip = getClientIp(request);
    console.log(`[WS] Nouvelle tentative de connexion depuis IP: ${ip}`);

    // 0. Vérification de l'adresse IP (Whitelist)
    if (!isIpAllowed(ip)) {
      console.warn(`[WS] Connexion refusée : IP non autorisée (${ip})`);
      client.close(4403, 'Forbidden IP');
      return;
    }

    // 1. Vérification de l'Origine (Origin header)
    const origin = request.headers.origin;
    const allowedOriginsStr = process.env.ALLOWED_ORIGINS;
    if (allowedOriginsStr) {
      const allowedOrigins = allowedOriginsStr
        .split(',')
        .map((o) => o.trim().toLowerCase());
      if (!origin || !allowedOrigins.includes(origin.toLowerCase())) {
        console.warn(`[WS] Connexion refusée : Origine non autorisée (${origin})`);
        client.close(4003, 'Forbidden Origin');
        return;
      }
    }

    // 2. Limitation du nombre de connexions simultanées par IP
    const currentConns = ipConnections.get(ip) || 0;
    if (currentConns >= MAX_CONNECTIONS_PER_IP) {
      console.warn(
        `[WS] Connexion refusée : Trop de connexions simultanées depuis l'IP ${ip}`,
      );
      client.close(4429, 'Too Many Connections from this IP');
      return;
    }
    ipConnections.set(ip, currentConns + 1);
    clientIps.set(client, ip);

    // 3. Authentification
    // Token lu prioritairement depuis le header de handshake ou cookie
    const urlObj = new URL(request.url || '', 'http://localhost');
    const queryToken = urlObj.searchParams.get('token');

    let cookieToken: string | null = null;
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce(
        (acc, c) => {
          const [key, val] = c.trim().split('=');
          if (key && val) acc[key] = decodeURIComponent(val);
          return acc;
        },
        {} as Record<string, string>,
      );
      cookieToken =
        cookies['token'] || cookies['session_token'] || cookies['access_token'] || null;
    }

    const token = queryToken || cookieToken;
    const operator = verifyOperatorToken(token);

    if (!operator.valid) {
      console.warn(
        `[WS] Connexion refusée : Authentification invalide pour IP ${ip}`,
      );
      client.close(4001, 'Unauthorized');

      const conns = ipConnections.get(ip) || 1;
      if (conns <= 1) {
        ipConnections.delete(ip);
      } else {
        ipConnections.set(ip, conns - 1);
      }
      clientIps.delete(client);
      return;
    }

    clientOperators.set(client, operator);
    console.log(
      `[WS] Opérateur '${operator.username}' connecté (IP: ${ip}, Origine: ${origin || 'direct'})`,
    );

    clientRateLimits.set(client, {
      messageCount: 0,
      lastReset: Date.now(),
    });

    client.send(
      JSON.stringify({
        event: 'camera_positions',
        data: this.camerasService.list(),
      }),
    );
    const bench = this.camerasService.railBenchState();
    client.send(
      JSON.stringify({
        event: 'rail_bench',
        data: { active: bench !== null, bench },
      }),
    );

    // 4. Ingestion des messages entrants & limitation de débit
    client.on('message', async (message) => {
      const rateInfo = clientRateLimits.get(client);
      if (rateInfo) {
        const now = Date.now();
        if (now - rateInfo.lastReset > 1000) {
          rateInfo.messageCount = 1;
          rateInfo.lastReset = now;
        } else {
          rateInfo.messageCount++;
          if (rateInfo.messageCount > MAX_MESSAGES_PER_SECOND) {
            console.warn(
              `[WS] Client IP ${ip} a dépassé la limite de débit. Déconnexion.`,
            );
            client.close(4429, 'Rate Limit Exceeded');
            return;
          }
        }
      }

      try {
        const raw = Array.isArray(message)
          ? Buffer.concat(message).toString()
          : Buffer.isBuffer(message)
            ? message.toString()
            : Buffer.from(message).toString();
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === 'object' && parsed.event === 'acknowledge_alert') {
          const alertId = parsed.data?.alertId;
          if (typeof alertId === 'string' && alertId.length > 0) {
            const op = clientOperators.get(client);
            if (op && op.valid) {
              await this.alertsService.acknowledge(alertId, op.username);
            }
          }
        }
      } catch (err) {
        console.warn(
          `[WS] Message invalide reçu de IP ${ip} :`,
          err instanceof Error ? err.message : err,
        );
        client.send(
          JSON.stringify({ event: 'error', data: 'Format de message invalide' }),
        );
      }
    });

    client.on('error', (err) => {
      console.error(`[WS] Erreur sur la socket pour IP ${ip} :`, err);
    });
  }

  handleDisconnect(client: WebSocket) {
    clientRateLimits.delete(client);
    clientOperators.delete(client);
    const ip = clientIps.get(client);
    if (ip) {
      const conns = ipConnections.get(ip);
      if (conns && conns > 1) {
        ipConnections.set(ip, conns - 1);
      } else {
        ipConnections.delete(ip);
      }
      clientIps.delete(client);
    }
    console.log(`[WS] Client déconnecté (IP: ${ip || 'inconnue'})`);
  }

  broadcast(event: string, data: unknown) {
    if (this.server && this.server.clients) {
      const payload = JSON.stringify({
        event,
        data,
      });

      this.server.clients.forEach((client) => {
        if (client.readyState === 1 && clientRateLimits.has(client)) {
          client.send(payload);
        }
      });
    }
  }
}
