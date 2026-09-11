import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'dgram';
import * as crypto from 'crypto';
import { EventsGateway } from './events.gateway';
import { CamerasService } from './cameras.service';
import { parseAttitudeLine, wrapHeadingDeg, AttitudePacket } from './udp-attitude';

interface TrackUpdatePayload {
  type: 'track_update';
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  timestamp: number;
  classification?: string;
}

@Injectable()
export class UdpService implements OnModuleInit, OnModuleDestroy {
  private server: dgram.Socket | null = null;

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly camerasService: CamerasService,
  ) { }

  /**
   * Vérifie la signature HMAC-SHA256 et la fraîcheur de l'horodatage d'un paquet UDP.
   * Format attendu du buffer binaire (minimum 40 octets) :
   * [Timestamp Unix BigEndian 8 octets] [HMAC-SHA256 32 octets] [Payload Télémesure CSV/JSON]
   */
  private verifyUdpPacket(buffer: Buffer, secretKey: string): { valid: boolean; payload?: Buffer; reason?: string } {
    if (buffer.length < 40) {
      return { valid: false, reason: 'Paquet trop court pour contenir la signature HMAC (minimum 40 octets)' };
    }

    try {
      const timestampMs = buffer.readBigInt64BE(0);
      const receivedHmac = buffer.subarray(8, 40);
      const payload = buffer.subarray(40);

      // 1. Protection Anti-Replay : rejeter si le paquet a plus de 2000 ms de retard ou 1000 ms dans le futur
      const nowMs = BigInt(Date.now());
      const diffMs = nowMs - timestampMs;
      if (diffMs > 2000n || timestampMs > nowMs + 1000n) {
        return { valid: false, reason: `Rejet Anti-Replay : horodatage hors fenêtre d'acceptation (écart: ${diffMs}ms)` };
      }

      // 2. Calcul et comparaison à temps constant de la signature HMAC-SHA256
      const hmac = crypto.createHmac('sha256', secretKey);
      hmac.update(buffer.subarray(0, 8));
      hmac.update(payload);
      const expectedHmac = hmac.digest();

      if (crypto.timingSafeEqual(receivedHmac, expectedHmac)) {
        return { valid: true, payload };
      } else {
        return { valid: false, reason: 'Signature HMAC invalide (usurpation potentielle)' };
      }
    } catch (err) {
      return { valid: false, reason: `Erreur lors du décodage HMAC: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  onModuleInit() {
    const port = parseInt(process.env.UDP_PORT || '41234', 10);
    const host = process.env.UDP_HOST || '0.0.0.0';
    const hmacSecret = process.env.UDP_HMAC_SECRET || process.env.UDP_SECRET_KEY || '';
    const requireHmac = process.env.UDP_REQUIRE_HMAC === 'true';

    this.server = dgram.createSocket('udp4');

    this.server.on('listening', () => {
      const address = this.server?.address();
      console.log(`[UDP] Serveur à l'écoute sur ${address?.address}:${address?.port} (HMAC: ${requireHmac ? 'Strict' : hmacSecret ? 'Optionnel' : 'Désactivé'})`);
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        let payloadBuffer: Buffer = msg;

        if (hmacSecret) {
          const verification = this.verifyUdpPacket(msg, hmacSecret);
          if (verification.valid && verification.payload) {
            payloadBuffer = Buffer.from(verification.payload);
            console.log(`[UDP] [HMAC OK] Paquet signé et authentifié avec succès de ${rinfo.address}:${rinfo.port}`);
          } else if (requireHmac) {
            console.warn(`[UDP] [HMAC REJET] Paquet rejeté de ${rinfo.address}:${rinfo.port} — ${verification.reason}`);
            return;
          }
        } else if (requireHmac) {
          console.warn(`[UDP] [HMAC REJET] Clé secrète UDP_HMAC_SECRET non configurée alors que UDP_REQUIRE_HMAC=true`);
          return;
        }

        const messageStr = payloadBuffer.toString('utf-8').trim();
        const parts = messageStr.split(',');
        if (parts[0] === 'att' && parts.length >= 6) {
          const attitude = parseAttitudeLine(messageStr);
          if (!attitude) return;
          this.ingestAttitude(attitude);
          return;
        }

        console.log(`[UDP] Message reçu de ${rinfo.address}:${rinfo.port} : ${messageStr}`);
        if (parts[0] === 'raw' && parts.length >= 8) {
          const detection = {
            type: 'raw_detection',
            cameraId: parts[1],
            frameIndex: parseInt(parts[2], 10),
            timestamp: parseFloat(parts[3]),
            x: parseFloat(parts[4]),
            y: parseFloat(parts[5]),
            size: parseFloat(parts[6]),
            confidence: parseFloat(parts[7]),
          };
          console.log('[UDP] Détection 2D brute parsée et diffusée :', detection);
          this.eventsGateway.broadcast('raw_detection', detection);
        } else if (parts[0].startsWith('obj') && parts.length >= 5) {
          const trackUpdate: TrackUpdatePayload = {
            type: 'track_update',
            trackId: parts[0],
            lat: parseFloat(parts[1]),
            lng: parseFloat(parts[2]),
            alt: parseFloat(parts[3]),
            timestamp: parseFloat(parts[4]),
          };
          if (parts.length >= 6) {
            trackUpdate.classification = parts[5].trim();
          }
          console.log('[UDP] Piste 3D GPS parsée et diffusée :', trackUpdate);
          this.eventsGateway.broadcast('track_update', trackUpdate);
        } else {
          // Message générique ou JSON brut
          let parsedJson: unknown = null;
          try {
            parsedJson = JSON.parse(messageStr);
          } catch {
            // Pas du JSON valide
          }

          const genericPayload = {
            type: 'generic_udp',
            raw: messageStr,
            data: parsedJson,
            sender: { address: rinfo.address, port: rinfo.port }
          };
          console.log('[UDP] Message inconnu/générique diffusé :', genericPayload);
          this.eventsGateway.broadcast('generic_udp', genericPayload);
        }
      } catch (error) {
        console.error('[UDP] Erreur de traitement du message :', error);
        // Diffusion de secours en cas d'erreur de traitement
        try {
          this.eventsGateway.broadcast('generic_udp', {
            type: 'generic_udp',
            raw: msg.toString().trim(),
            error: error instanceof Error ? error.message : String(error),
          });
        } catch (e) {
          console.error('[UDP] Échec de la diffusion de secours :', e);
        }
      }
    });

    this.server.on('error', (err) => {
      console.error('[UDP] Erreur du serveur UDP :', err);
      this.server?.close();
    });

    this.server.bind(port, host);
  }

  /** IMU from UDP or HTTP: always broadcast, even if cameraId is unknown. */
  ingestAttitude(attitude: AttitudePacket): void {
    const headingDeg = wrapHeadingDeg(attitude.headingDeg);
    this.eventsGateway.broadcast('imu_update', {
      cameraId: attitude.cameraId,
      headingDeg,
      elevationDeg: attitude.elevationDeg,
      rollDeg: attitude.rollDeg,
      timestamp: attitude.timestamp,
    });
    const updated = this.camerasService.updateAttitude(
      attitude.cameraId,
      headingDeg,
    );
    if (updated) {
      this.eventsGateway.broadcast(
        'camera_positions',
        this.camerasService.list(),
      );
    }
  }

  onModuleDestroy() {
    if (this.server) {
      this.server.close();
      console.log('[UDP] Serveur UDP fermé.');
    }
  }
}
