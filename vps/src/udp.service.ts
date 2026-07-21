import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'dgram';
import { EventsGateway } from './events.gateway';

@Injectable()
export class UdpService implements OnModuleInit, OnModuleDestroy {
  private server: dgram.Socket | null = null;

  constructor(private readonly eventsGateway: EventsGateway) {}

  onModuleInit() {
    const port = parseInt(process.env.UDP_PORT || '41234', 10);
    const host = process.env.UDP_HOST || '0.0.0.0';

    this.server = dgram.createSocket('udp4');

    this.server.on('listening', () => {
      const address = this.server?.address();
      console.log(`[UDP] Serveur à l'écoute sur ${address?.address}:${address?.port}`);
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        const messageStr = msg.toString().trim();
        console.log(`[UDP] Message reçu de ${rinfo.address}:${rinfo.port} : ${messageStr}`);
        
        const parts = messageStr.split(',');
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
          const trackUpdate: any = {
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
          let parsedJson: any = null;
          try {
            parsedJson = JSON.parse(messageStr);
          } catch (e) {
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

  onModuleDestroy() {
    if (this.server) {
      this.server.close();
      console.log('[UDP] Serveur UDP fermé.');
    }
  }
}
