import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'dgram';
import { EventsGateway } from '../realtime/events.gateway';
import { CamerasService } from '../cameras/cameras.service';
import type { CameraConfig } from '../cameras/cameras.service';
import { FusionService } from '../fusion/fusion.service';
import type {
  FusionObservation,
  FusionTrackUpdate,
  FuseUpdate,
} from '../fusion/fusion.types';
import { wrapHeadingDeg, type AttitudePacket } from './udp-attitude';
import type { RawDetection } from './udp-raw';
import { routeUdpLine, type RoutedUdp, type UdpObjTrack } from './udp-route';
import { udpDebug } from './udp-log';
import { TracksService } from '../tracks/tracks.service';
import { AlertsService } from '../alerts/alerts.service';
import type { RailLocalPose } from '../bench/rail-bench';
import { ClassificationService } from '../classification/classification.service';
import { TuningService } from '../tuning/tuning.service';
import { CameraHealthService } from '../cameras/camera-health.service';
import {
  MessageVerifier,
  readSharedSecret,
  signPacket,
  type RejectReason,
} from '../common/message-auth';

const REJECTION_LOG_INTERVAL_MS = 10_000;

interface CameraEndpoint {
  address: string;
  port: number;
  lastSeenMs: number;
}

export function buildSignedUdpPacket(
  payloadText: string,
  secret: string,
): Buffer {
  const line = payloadText.endsWith('\n') ? payloadText : `${payloadText}\n`;
  return signPacket(Buffer.from(line, 'utf8'), secret);
}

@Injectable()
export class UdpService implements OnModuleInit, OnModuleDestroy {
  private server: dgram.Socket | null = null;
  private readonly seenCameras = new Set<string>();
  private readonly unknownCameras = new Set<string>();
  private readonly cameraEndpoints = new Map<string, CameraEndpoint>();
  private hmacSecret = '';
  private verifier: MessageVerifier | null = null;
  private readonly rejections = new Map<RejectReason, number>();
  private lastRejectionLogMs = 0;
  // fuse_update: au plus un envoi par fenêtre, le dernier état part en fin
  // de fenêtre (une détection = un blob, soit des centaines par seconde).
  // La durée de la fenêtre est un réglage à chaud (TuningService).
  private lastFuseBroadcastMs = 0;
  private fuseBroadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly camerasService: CamerasService,
    private readonly fusion: FusionService,
    private readonly tracksService: TracksService,
    private readonly alertsService: AlertsService,
    private readonly classification: ClassificationService,
    private readonly tuning: TuningService,
    private readonly cameraHealth: CameraHealthService,
  ) {}

  onModuleInit() {
    const port = parseInt(process.env.UDP_PORT || '41234', 10);
    const host = process.env.UDP_HOST || '0.0.0.0';
    this.hmacSecret = readSharedSecret();
    this.verifier = new MessageVerifier(this.hmacSecret);

    this.server = dgram.createSocket('udp4');

    this.server.on('listening', () => {
      const address = this.server?.address();
      console.log(
        `[UDP] Serveur à l'écoute sur ${address?.address}:${address?.port}, trames signées exigées`,
      );
    });

    this.server.on('message', (packet, rinfo) => this.receive(packet, rinfo));

    this.server.on('error', (err) => {
      console.error('[UDP] Erreur du serveur UDP :', err);
      this.server?.close();
    });

    this.server.bind(port, host);
  }

  private receive(packet: Buffer, rinfo: dgram.RemoteInfo): void {
    if (!this.verifier) return;
    const verification = this.verifier.verifyPacket(packet);
    if (!verification.ok) {
      this.noteRejection(verification.reason, rinfo);
      return;
    }
    const line = verification.payload.toString('utf-8').trim();
    try {
      this.dispatchRouted(routeUdpLine(line), line, rinfo);
    } catch (error) {
      console.error('[UDP] Erreur de traitement du message :', error);
    }
  }

  private noteRejection(reason: RejectReason, rinfo: dgram.RemoteInfo): void {
    this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);
    const now = Date.now();
    if (now - this.lastRejectionLogMs < REJECTION_LOG_INTERVAL_MS) return;
    const summary = [...this.rejections]
      .map(([key, count]) => `${key}=${count}`)
      .join(' ');
    console.warn(
      `[UDP] Paquets rejetés : ${summary} (dernier : ${rinfo.address}:${rinfo.port})`,
    );
    this.rejections.clear();
    this.lastRejectionLogMs = now;
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
        this.noteEndpoint(routed.attitude.cameraId, rinfo);
        this.noteFirstFrame(routed.attitude.cameraId, 'att');
        this.cameraHealth.noteActivity(routed.attitude.cameraId);
        this.ingestAttitude(routed.attitude);
        return;
      case 'raw':
        udpDebug(`[UDP] Message reçu de ${from} : ${messageStr}`);
        udpDebug('[UDP] Détection 2D brute :', routed.detection);
        this.noteEndpoint(routed.detection.cameraId, rinfo);
        this.noteFirstFrame(routed.detection.cameraId, 'raw');
        this.cameraHealth.noteActivity(routed.detection.cameraId);
        this.ingestRawDetection(routed.detection);
        return;
      case 'stats':
        this.noteEndpoint(routed.stats.cameraId, rinfo);
        this.noteFirstFrame(routed.stats.cameraId, 'stats');
        this.cameraHealth.noteActivity(routed.stats.cameraId, routed.stats.frameIndex);
        this.cameraHealth.ingestStats(routed.stats);
        this.eventsGateway.broadcast('camera_stats', routed.stats);
        return;
      case 'cfg':
        this.noteEndpoint(routed.report.cameraId, rinfo);
        this.noteFirstFrame(routed.report.cameraId, 'cfg');
        if (this.tuning.noteReport(routed.report)) {
          this.eventsGateway.broadcast('tuning_state', this.tuning.state());
        }
        // Le détecteur n'applique pas (ou plus) ce qui est voulu : la
        // commande s'est perdue ou il a redémarré. On la renvoie.
        this.pushTuning([routed.report.cameraId]);
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

  private noteEndpoint(cameraId: string, rinfo: dgram.RemoteInfo): void {
    if (!cameraId) return;
    this.cameraEndpoints.set(cameraId, {
      address: rinfo.address,
      port: rinfo.port,
      lastSeenMs: Date.now(),
    });
  }

  private onlineCameraIds(now = Date.now()): string[] {
    const staleMs =
      Number(process.env.CLASSIFICATION_ENDPOINT_STALE_MS) || 5000;
    return [...this.cameraEndpoints.entries()]
      .filter(([, endpoint]) => now - endpoint.lastSeenMs <= staleMs)
      .map(([cameraId]) => cameraId);
  }

  private sendCaptureRequests(trigger: {
    requestId: string;
    cameraIds: string[];
    expiresAt: number;
  }): void {
    if (!this.server) return;
    for (const cameraId of trigger.cameraIds) {
      const endpoint = this.cameraEndpoints.get(cameraId);
      if (!endpoint) continue;
      const packet = buildSignedUdpPacket(
        `capture,${cameraId},${trigger.requestId},${trigger.expiresAt}`,
        this.hmacSecret,
      );
      this.server.send(packet, endpoint.port, endpoint.address, (error) => {
        if (error) {
          console.error(
            `[CLASSIFICATION] capture command failed for ${cameraId}:`,
            error,
          );
        }
      });
    }
    console.log(
      `[CLASSIFICATION] requested ${trigger.requestId} from ${trigger.cameraIds.join(',')}`,
    );
  }

  /**
   * Envoie leur commande de réglage aux détecteurs qui n'appliquent pas ce
   * qui est voulu. Sans liste : tous ceux qui ont une commande en attente.
   */
  pushTuning(cameraIds?: string[]): void {
    if (!this.server) return;
    for (const cameraId of cameraIds ?? this.tuning.pendingCameraIds()) {
      const command = this.tuning.pendingCommand(cameraId);
      const endpoint = this.cameraEndpoints.get(cameraId);
      if (!command || !endpoint) continue;
      this.server.send(
        buildSignedUdpPacket(command, this.hmacSecret),
        endpoint.port,
        endpoint.address,
        (error) => {
          if (error) {
            console.error(
              `[TUNING] commande refusée pour ${cameraId} :`,
              error,
            );
          }
        },
      );
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
    const calibratedRailPose = railPoseFromDetection(detection);
    if (
      calibratedRailPose &&
      this.camerasService.updateRailCalibration(
        detection.cameraId,
        calibratedRailPose,
      )
    ) {
      this.eventsGateway.broadcast(
        'camera_positions',
        this.camerasService.list(),
      );
      const bench = this.camerasService.railBenchState();
      if (bench) {
        this.eventsGateway.broadcast('rail_bench', { active: true, bench });
      }
    }
    const camera = this.camerasService
      .list()
      .find((item) => item.id === detection.cameraId);
    const local = this.camerasService.localPose(detection.cameraId);
    this.fusion.ingest(
      toFusionObservation(
        detection,
        camera,
        Date.now(),
        local,
        this.tuning.frameSize(detection.cameraId),
      ),
    );
    this.eventsGateway.broadcast('raw_detection', detection);
    const snap = this.fusion.snapshot();
    this.scheduleFuseBroadcast();
    const trigger = this.classification.considerFusion(
      snap.lastFuse,
      this.onlineCameraIds(),
    );
    if (trigger) this.sendCaptureRequests(trigger);
    for (const update of this.fusion.pullTrackUpdates()) {
      this.eventsGateway.broadcast('track_update', update);
      this.recordAndAlertTrack(update);
    }
  }

  private scheduleFuseBroadcast(): void {
    const now = Date.now();
    const wait = this.lastFuseBroadcastMs + this.tuning.broadcastMs() - now;
    if (wait <= 0) {
      this.broadcastFuse(now);
      return;
    }
    if (this.fuseBroadcastTimer) return;
    this.fuseBroadcastTimer = setTimeout(() => {
      this.fuseBroadcastTimer = null;
      this.broadcastFuse(Date.now());
    }, wait);
    this.fuseBroadcastTimer.unref?.();
  }

  private broadcastFuse(now: number): void {
    // Un envoi immédiat rend l'envoi différé en attente inutile : sans cette
    // annulation, les deux partent à moins d'une milliseconde d'écart.
    if (this.fuseBroadcastTimer) {
      clearTimeout(this.fuseBroadcastTimer);
      this.fuseBroadcastTimer = null;
    }
    this.lastFuseBroadcastMs = now;
    const snap = this.fusion.snapshot();
    const fuseUpdate: FuseUpdate = {
      type: 'fuse_update',
      lastFuse: snap.lastFuse,
      rawIntersections: snap.rawIntersections,
      tracks: snap.tracks,
    };
    this.eventsGateway.broadcast('fuse_update', fuseUpdate);
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
    this.alertsService.processTrackAlert({
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
    if (this.fuseBroadcastTimer) {
      clearTimeout(this.fuseBroadcastTimer);
      this.fuseBroadcastTimer = null;
    }
    if (this.server) {
      this.server.close();
      console.log('[UDP] Serveur UDP fermé.');
    }
  }
}

export function toFusionObservation(
  detection: RawDetection,
  camera: CameraConfig | undefined,
  receivedAtMs: number,
  local?: RailLocalPose | null,
  frame?: { width: number; height: number } | null,
): FusionObservation {
  const frozen = local ?? null;
  // La taille réelle de l'image ne sert qu'avec des intrinsèques explicites :
  // sans elles la fusion les déduit du champ de vision pour 1280 × 720, et les
  // poses ajustées du banc de rejeu reposent sur cette hypothèse.
  const size =
    frame && detection.fx !== undefined && detection.fx > 0
      ? { imageWidth: frame.width, imageHeight: frame.height }
      : {};
  return {
    ...size,
    cameraId: detection.cameraId,
    frameIndex: detection.frameIndex,
    timestampUs: detection.timestamp,
    x: detection.x,
    y: detection.y,
    size: detection.size,
    confidence: detection.confidence,
    receivedAtMs,
    // Sans cap dans la trame, le cap IMU de la config caméra ; sinon la
    // fusion écarte l'observation plutôt que de supposer le nord.
    headingDeg: frozen
      ? frozen.headingDeg
      : (detection.headingDeg ?? camera?.headingDeg),
    elevationDeg: frozen ? frozen.elevationDeg : detection.elevationDeg,
    rollDeg: frozen ? frozen.rollDeg : detection.rollDeg,
    fovDeg: detection.fovDeg ?? camera?.fovDeg,
    fx: detection.fx,
    fy: detection.fy,
    cx: detection.cx,
    cy: detection.cy,
    k1: detection.k1,
    k2: detection.k2,
    p1: detection.p1,
    p2: detection.p2,
    k3: detection.k3,
    lat: camera?.lat,
    lon: camera?.lon,
    alt: camera?.alt,
    camX: frozen?.x,
    camY: frozen?.y,
    camZ: frozen?.z,
  };
}

export function railPoseFromDetection(
  detection: RawDetection,
): RailLocalPose | null {
  const values = [
    detection.railX,
    detection.railY,
    detection.railZ,
    detection.railHeadingDeg,
    detection.railElevationDeg,
    detection.railRollDeg,
  ];
  if (
    !values.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return null;
  }
  return {
    id: detection.cameraId as RailLocalPose['id'],
    x: detection.railX!,
    y: detection.railY!,
    z: detection.railZ!,
    headingDeg: wrapHeadingDeg(detection.railHeadingDeg!),
    elevationDeg: detection.railElevationDeg!,
    rollDeg: detection.railRollDeg!,
  };
}
