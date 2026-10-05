import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'dgram';
import { buildSignedUdpPacket } from '../udp/udp.service';

@Injectable()
export class SimulationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulationService.name);
  private clientSocket: dgram.Socket | null = null;
  private simInterval: ReturnType<typeof setInterval> | null = null;

  onModuleInit() {
    const isProd = process.env.NODE_ENV === 'production';
    const isSimEnabled = process.env.SIMULATION_MODE === 'true';

    if (isProd) {
      if (isSimEnabled) {
        this.logger.error(
          'SIMULATION_MODE ne peut PAS être activé en environnement de PRODUCTION ! Mode simulation annulé.',
        );
      }
      return;
    }

    if (isSimEnabled) {
      this.logger.log(
        'Mode simulation activé (génération de trames UDP signées HMAC pour la démo).',
      );
      this.clientSocket = dgram.createSocket('udp4');
    }
  }

  async runScenario(
    scenarioName: string,
  ): Promise<{ success: boolean; message: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        message: 'Scénarios de simulation interdits en production',
      };
    }

    if (!this.clientSocket) {
      return {
        success: false,
        message: 'Client de simulation non initialisé (SIMULATION_MODE=false)',
      };
    }

    const udpPort = parseInt(process.env.UDP_PORT || '41234', 10);
    const hmacSecret = process.env.UDP_HMAC_SECRET ?? '';

    switch (scenarioName) {
      case 'mask_cam1': {
        // Envoi d'une trame stats avec chute de luminance sur jean (CAM 1)
        const line = `stats,v2,jean,29.8,1042,${Date.now()},8.5,2.1,0.01,12.0,50000,18.0`;
        const packet = buildSignedUdpPacket(line, hmacSecret);
        this.clientSocket.send(packet, udpPort, '127.0.0.1');
        return {
          success: true,
          message: 'Scénario Masque Physique injecté sur CAM 1 (jean)',
        };
      }
      case 'freeze_cam3': {
        // Envoi de trames avec frame_diff = 0 sur walid (CAM 3)
        const line = `stats,v2,walid,30.0,2010,${Date.now()},110.0,15.0,0.00,45.0,10000,0.0`;
        const packet = buildSignedUdpPacket(line, hmacSecret);
        this.clientSocket.send(packet, udpPort, '127.0.0.1');
        return {
          success: true,
          message: 'Scénario Flux Figé injecté sur CAM 3 (walid)',
        };
      }
      case 'night_fall': {
        // Assombrissement simultané sur les 3 caméras (baisse progressive)
        const now = Date.now();
        for (const cam of ['jean', 'tanel', 'walid']) {
          const line = `stats,v2,${cam},30.0,3000,${now},12.0,3.5,0.15,10.0,40000,12.0`;
          const packet = buildSignedUdpPacket(line, hmacSecret);
          this.clientSocket.send(packet, udpPort, '127.0.0.1');
        }
        return {
          success: true,
          message: 'Scénario Tombée de la Nuit (baisse collective) injecté',
        };
      }
      case 'drone_confirmed_3d': {
        // Injection d'une détection confirmée
        const now = Date.now();
        const line = `obj99,48.82613,2.36585,45.0,${now * 1000},drone`;
        const packet = buildSignedUdpPacket(line, hmacSecret);
        this.clientSocket.send(packet, udpPort, '127.0.0.1');
        return {
          success: true,
          message: 'Scénario Drone Confirmé 3D (obj99) injecté',
        };
      }
      default:
        return {
          success: false,
          message: `Scénario inconnu : ${scenarioName}`,
        };
    }
  }

  onModuleDestroy() {
    if (this.simInterval) clearInterval(this.simInterval);
    if (this.clientSocket) this.clientSocket.close();
  }
}
