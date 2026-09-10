import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getClientIp, isIpAllowed, isValidAuthToken } from './access-control';
import { CamerasService } from './cameras.service';

// Suivi des connexions et limitations par IP
const ipConnections = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 5;

// Limitation du débit des messages par client
interface ClientRateLimit {
  messageCount: number;
  lastReset: number;
}
const clientRateLimits = new Map<WebSocket, ClientRateLimit>();
const MAX_MESSAGES_PER_SECOND = 10;

// Association client -> IP pour le nettoyage à la déconnexion
const clientIps = new Map<WebSocket, string>();

@WebSocketGateway()
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly camerasService: CamerasService) {}

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
      const allowedOrigins = allowedOriginsStr.split(',').map((o) => o.trim().toLowerCase());
      if (!origin || !allowedOrigins.includes(origin.toLowerCase())) {
        console.warn(`[WS] Connexion refusée : Origine non autorisée (${origin})`);
        client.close(4003, 'Forbidden Origin');
        return;
      }
    }

    // 2. Limitation du nombre de connexions simultanées par IP
    const currentConns = ipConnections.get(ip) || 0;
    if (currentConns >= MAX_CONNECTIONS_PER_IP) {
      console.warn(`[WS] Connexion refusée : Trop de connexions simultanées depuis l'IP ${ip}`);
      client.close(4429, 'Too Many Connections from this IP');
      return;
    }
    ipConnections.set(ip, currentConns + 1);
    clientIps.set(client, ip);

    // 3. Authentification (Token en URL query ou Cookie de session)
    const urlObj = new URL(request.url || '', 'http://localhost');
    const queryToken = urlObj.searchParams.get('token');

    // Extraction des cookies
    let cookieToken: string | null = null;
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val) acc[key] = decodeURIComponent(val);
        return acc;
      }, {} as Record<string, string>);
      cookieToken = cookies['token'] || cookies['session_token'] || cookies['access_token'] || null;
    }

    const token = queryToken || cookieToken;

    if (!isValidAuthToken(token)) {
      console.warn(`[WS] Connexion refusée : Authentification invalide pour IP ${ip}`);
      client.close(4001, 'Unauthorized');

      // Nettoyage immédiat suite au rejet
      const conns = ipConnections.get(ip) || 1;
      if (conns <= 1) {
        ipConnections.delete(ip);
      } else {
        ipConnections.set(ip, conns - 1);
      }
      clientIps.delete(client);
      return;
    }

    console.log(`[WS] Client connecté avec succès (IP: ${ip}, Origine: ${origin || 'direct'})`);

    // Initialisation du limiteur de débit de messages
    clientRateLimits.set(client, {
      messageCount: 0,
      lastReset: Date.now(),
    });

    // Positions actuelles des caméras ; chaque modification est ensuite diffusée à tous
    client.send(JSON.stringify({ event: 'camera_positions', data: this.camerasService.list() }));

    // 4. Validation des messages entrants & limitation de débit
    client.on('message', (message) => {
      const rateInfo = clientRateLimits.get(client);
      if (rateInfo) {
        const now = Date.now();
        if (now - rateInfo.lastReset > 1000) {
          rateInfo.messageCount = 1;
          rateInfo.lastReset = now;
        } else {
          rateInfo.messageCount++;
          if (rateInfo.messageCount > MAX_MESSAGES_PER_SECOND) {
            console.warn(`[WS] Client IP ${ip} a dépassé la limite de débit. Déconnexion.`);
            client.close(4429, 'Rate Limit Exceeded');
            return;
          }
        }
      }

      // Validation stricte du JSON
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.event && typeof parsed.event !== 'string') {
          throw new Error('Le champ "event" doit être une chaîne de caractères.');
        }
      } catch (err) {
        console.warn(`[WS] Message invalide reçu de IP ${ip} :`, err instanceof Error ? err.message : err);
        client.send(JSON.stringify({ event: 'error', data: 'Format de message invalide' }));
      }
    });

    client.on('error', (err) => {
      console.error(`[WS] Erreur sur la socket pour IP ${ip} :`, err);
    });
  }

  handleDisconnect(client: WebSocket) {
    clientRateLimits.delete(client);
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

  broadcast(event: string, data: any) {
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
