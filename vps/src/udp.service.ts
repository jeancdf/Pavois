import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'dgram';
import * as crypto from 'crypto';
import { EventsGateway } from './events.gateway';
import { CamerasService } from './cameras.service';
import type { CameraConfig } from './cameras.service';
import { FusionService } from './fusion.service';
import type { FusionObservation } from './fusion.types';
import { wrapHeadingDeg, type AttitudePacket } from './udp-attitude';
import type { RawDetection } from './udp-raw';
import { routeUdpLine, type RoutedUdp, type UdpObjTrack } from './udp-route';
import { udpDebug } from './udp-log';
import { TracksService } from './tracks.service';
import { AlertsService } from './alerts.service';
import type { FusionTrackUpdate } from './fusion.types';

@Injectable()
export class UdpService implements OnModuleInit, OnModuleDestroy {
  private server: dgram.Socket | null = null;
  private readonly seenCameras = new Set<string>();
  private readonly unknownCameras = new Set<string>();

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly camerasService: CamerasService,
    private readonly fusion: FusionService,
    private readonly tracksService: TracksService,
    private readonly alertsService: AlertsService,
  ) {}

  /**
   * Vérifie la signature HMAC-SHA256 et la fraîcheur de l'horodatage d'un paquet UDP.
   * Format attendu du buffer binaire (minimum 40 octets) :
   * [Timestamp Unix BigEndian 8 octets] [HMAC-SHA256 32 octets] [Payload Télémesure CSV/JSON]
   */
  private verifyUdpPacket(
    buffer: Buffer,
    secretKey: string,
  ): { valid: boolean; payload?: Buffer; reason?: string } {
    if (buffer.length < 40) {
      return {
        valid: false,
        reason:
          'Paquet trop court pour contenir la signature HMAC (minimum 40 octets)',
      };
    }

    try {
      const timestampMs = buffer.readBigInt64BE(0);
      const receivedHmac = buffer.subarray(8, 40);
      const payload = buffer.subarray(40);

      // 1. Protection Anti-Replay : rejeter si le paquet a plus de 2000 ms de retard ou 1000 ms dans le futur
      const nowMs = BigInt(Date.now());
      const diffMs = nowMs - timestampMs;
      if (diffMs > 2000n || timestampMs > nowMs + 1000n) {
        return {
          valid: false,
          reason: `Rejet Anti-Replay : horodatage hors fenêtre d'acceptation (écart: ${diffMs}ms)`,
        };
      }

      // 2. Calcul et comparaison à temps constant de la signature HMAC-SHA256
      const hmac = crypto.createHmac('sha256', secretKey);
      hmac.update(buffer.subarray(0, 8));
      hmac.update(payload);
      const expectedHmac = hmac.digest();

      if (crypto.timingSafeEqual(receivedHmac, expectedHmac)) {
        return { valid: true, payload };
      } else {
        return {
          valid: false,
          reason: 'Signature HMAC invalide (usurpation potentielle)',
        };
      }
    } catch (err) {
      return {
        valid: false,
        reason: `Erreur lors du décodage HMAC: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  onModuleInit() {
    const port = parseInt(process.env.UDP_PORT || '41234', 10);
    const host = process.env.UDP_HOST || '0.0.0.0';
    const hmacSecret =
      process.env.UDP_HMAC_SECRET || process.env.UDP_SECRET_KEY || '';
    const requireHmac = process.env.UDP_REQUIRE_HMAC === 'true';

    this.server = dgram.createSocket('udp4');

    this.server.on('listening', () => {
      const address = this.server?.address();
      console.log(
        `[UDP] Serveur à l'écoute sur ${address?.address}:${address?.port} (HMAC: ${requireHmac ? 'Strict' : hmacSecret ? 'Optionnel' : 'Désactivé'})`,
      );
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        let payloadBuffer: Buffer = msg;

        if (hmacSecret) {
          const verification = this.verifyUdpPacket(msg, hmacSecret);
          if (verification.valid && verification.payload) {
            payloadBuffer = Buffer.from(verification.payload);
            udpDebug(
              `[UDP] [HMAC OK] Paquet signé de ${rinfo.address}:${rinfo.port}`,
            );
          } else if (requireHmac) {
            console.warn(
              `[UDP] [HMAC REJET] Paquet rejeté de ${rinfo.address}:${rinfo.port} — ${verification.reason}`,
            );
            return;
          }
        } else if (requireHmac) {
          console.warn(
            `[UDP] [HMAC REJET] Clé secrète UDP_HMAC_SECRET non configurée alors que UDP_REQUIRE_HMAC=true`,
          );
          return;
        }

        const messageStr = payloadBuffer.toString('utf-8').trim();
        this.dispatchRouted(
          routeUdpLine(messageStr),
          messageStr,
          rinfo,
        );
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

  private dispatchRouted(
    routed: RoutedUdp,
    messageStr: string,
    rinfo: dgram.RemoteInfo,
  ): void {
    const from = `${rinfo.address}:${rinfo.port}`;
    switch (routed.kind) {
      case 'drop':
        return;
      case 'att':
        this.noteFirstFrame(routed.attitude.cameraId, 'att');
        this.ingestAttitude(routed.attitude);
        return;
      case 'raw':
        udpDebug(`[UDP] Message reçu de ${from} : ${messageStr}`);
        udpDebug('[UDP] Détection 2D brute :', routed.detection);
        this.noteFirstFrame(routed.detection.cameraId, 'raw');
        this.ingestRawDetection(routed.detection);
        return;
      case 'obj':
        udpDebug(`[UDP] Message reçu de ${from} : ${messageStr}`);
        udpDebug('[UDP] Piste 3D GPS :', routed.track);
        this.eventsGateway.broadcast('track_update', routed.track);
        this.recordAndAlertTrack(routed.track);
        return;
      case 'unknown': {
        const genericPayload = {
          type: 'generic_udp',
          raw: routed.raw,
          data: routed.data,
          sender: { address: rinfo.address, port: rinfo.port },
        };
        console.warn(`[UDP] Message inconnu de ${from}`);
        udpDebug('[UDP] Payload inconnu :', genericPayload);
        this.eventsGateway.broadcast('generic_udp', genericPayload);
      }
    }
  }

  private noteFirstFrame(cameraId: string, kind: string): void {
    const key = `${kind}:${cameraId}`;
    if (this.seenCameras.has(key)) {
      return;
    }
    this.seenCameras.add(key);
    console.log(`[UDP] Première trame ${kind} pour ${cameraId}`);
    const known = this.camerasService
      .list()
      .some((item) => item.id === cameraId);
    if (!known) {
      this.warnUnknownCamera(cameraId);
    }
  }

  private warnUnknownCamera(cameraId: string): void {
    if (this.unknownCameras.has(cameraId)) {
      return;
    }
    this.unknownCameras.add(cameraId);
    console.warn(`[UDP] Identifiant caméra inconnu : ${cameraId}`);
  }

  /**
   * Stocke la détection, fusionne, et pousse les pistes GPS confirmées.
   */
  ingestRawDetection(detection: RawDetection): void {
    const camera = this.camerasService
      .list()
      .find((item) => item.id === detection.cameraId);
    this.fusion.ingest(toFusionObservation(detection, camera, Date.now()));
    this.eventsGateway.broadcast('raw_detection', detection);
    this.alertsService.onRawDetection({
      cameraId: detection.cameraId,
      confidence: detection.confidence,
    });
    for (const update of this.fusion.pullTrackUpdates()) {
      this.eventsGateway.broadcast('track_update', update);
      this.recordAndAlertTrack(update);
    }
  }

  /** Journalise la piste (accuracy) et déclenche les règles d'alerte. */
  private recordAndAlertTrack(track: UdpObjTrack | FusionTrackUpdate): void {
    void this.tracksService.record({
      trackId: track.trackId,
      lat: track.lat,
      lng: track.lng,
      alt: track.alt,
      classification: track.classification,
      timestamp: track.timestamp,
    });
    this.alertsService.onTrackUpdate({
      trackId: track.trackId,
      classification: track.classification,
    });
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
      calibration: attitude.calibration,
      valid: attitude.valid,
    });
    // Cap figé (lecture ratée côté Pi) : on ne tourne pas le cône.
    if (!attitude.valid) return;
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

function toFusionObservation(
  detection: RawDetection,
  camera: CameraConfig | undefined,
  receivedAtMs: number,
): FusionObservation {
  return {
    cameraId: detection.cameraId,
    frameIndex: detection.frameIndex,
    timestampUs: detection.timestamp,
    x: detection.x,
    y: detection.y,
    size: detection.size,
    confidence: detection.confidence,
    receivedAtMs,
    headingDeg: detection.headingDeg,
    elevationDeg: detection.elevationDeg,
    rollDeg: detection.rollDeg,
    fovDeg: detection.fovDeg ?? camera?.fovDeg,
    fx: detection.fx,
    fy: detection.fy,
    cx: detection.cx,
    cy: detection.cy,
    lat: camera?.lat,
    lon: camera?.lon,
    alt: camera?.alt,
  };
}
