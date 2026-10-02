import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CameraState } from '@prisma/client';
import { CameraStats } from './udp-stats';

export interface CameraHealthStatus {
  cameraId: string;
  displayName: string;
  state: CameraState;
  previousState: CameraState | null;
  reason: string;
  lastSeenMs: number;
  lastFrameIndex: number;
  lumMean: number;
  lumStddev: number;
  exposureUs: number;
  gainDb: number;
}

export type GlobalReliability = 'GREEN' | 'ORANGE' | 'RED';

export interface SystemHealthUpdate {
  reliability: GlobalReliability;
  activeCameraCount: number;
  message: string;
}

const CAMERA_NAME_MAP: Record<string, string> = {
  jean: 'CAM 1',
  tanel: 'CAM 2',
  walid: 'CAM 3',
};

@Injectable()
export class CameraHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CameraHealthService.name);
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  private readonly cameraStates = new Map<string, CameraHealthStatus>();
  private readonly cameraMetricsHistory = new Map<
    string,
    { timestamp: number; lumMean: number }[]
  >();
  private readonly frozenBaselines = new Map<string, number>();

  // Diagnostic callbacks registered by AlertsService
  private onStateChangeCallback?: (
    status: CameraHealthStatus,
    globalUpdate: SystemHealthUpdate,
  ) => void;

  onModuleInit() {
    const defaultCameras = ['jean', 'tanel', 'walid'];
    for (const id of defaultCameras) {
      this.cameraStates.set(id, {
        cameraId: id,
        displayName: CAMERA_NAME_MAP[id] || id.toUpperCase(),
        state: CameraState.OK,
        previousState: null,
        reason: 'Initialisé OK',
        lastSeenMs: Date.now(),
        lastFrameIndex: 0,
        lumMean: 100,
        lumStddev: 20,
        exposureUs: 10000,
        gainDb: 0,
      });
      this.frozenBaselines.set(id, 100);
      this.cameraMetricsHistory.set(id, []);
    }

    // Run health check loop every 1 second
    this.checkInterval = setInterval(() => this.evaluateCameraHealth(), 1000);
  }

  onStateChange(
    callback: (
      status: CameraHealthStatus,
      globalUpdate: SystemHealthUpdate,
    ) => void,
  ) {
    this.onStateChangeCallback = callback;
  }

  /**
   * Called on every received UDP packet (`stats`, `att`, or `raw`).
   */
  noteActivity(cameraId: string, frameIndex?: number) {
    const current = this.cameraStates.get(cameraId);
    if (!current) return;

    current.lastSeenMs = Date.now();
    if (typeof frameIndex === 'number' && frameIndex > current.lastFrameIndex) {
      current.lastFrameIndex = frameIndex;
    }
  }

  /**
   * Called when a `stats` frame is received.
   */
  ingestStats(stats: CameraStats) {
    const current = this.cameraStates.get(stats.cameraId);
    if (!current) return;

    current.lastSeenMs = Date.now();
    current.lastFrameIndex = stats.frameIndex;

    if (typeof stats.lumMean === 'number') {
      current.lumMean = stats.lumMean;
      current.lumStddev = stats.lumStddev ?? 10;
      current.exposureUs = stats.exposureUs ?? 0;
      current.gainDb = stats.gainDb ?? 0;

      // Update 60s sliding median baseline ONLY IF camera is in OK or REDUCED_VISIBILITY_NIGHT
      // BUG LIGNE DE BASE : Baseline is FROZEN while camera is in BLIND, FROZEN, HORS_SERVICE, RECOVERING!
      if (
        current.state === CameraState.OK ||
        current.state === CameraState.REDUCED_VISIBILITY_NIGHT
      ) {
        const history = this.cameraMetricsHistory.get(stats.cameraId) || [];
        const now = Date.now();
        history.push({ timestamp: now, lumMean: stats.lumMean });
        // Keep last 60 seconds
        const filtered = history.filter((h) => now - h.timestamp <= 60000);
        this.cameraMetricsHistory.set(stats.cameraId, filtered);

        if (filtered.length > 0) {
          const sorted = [...filtered].map((h) => h.lumMean).sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          this.frozenBaselines.set(stats.cameraId, median);
        }
      }
    }
  }

  getHealthStatuses(): CameraHealthStatus[] {
    return Array.from(this.cameraStates.values());
  }

  getGlobalReliability(): SystemHealthUpdate {
    const statuses = this.getHealthStatuses();
    // A DEGRADED camera does NOT count as OK!
    const activeCount = statuses.filter(
      (s) =>
        s.state === CameraState.OK ||
        s.state === CameraState.REDUCED_VISIBILITY_NIGHT,
    ).length;

    let reliability: GlobalReliability = 'GREEN';
    let message = 'Système 3D Nominal (3/3 Caméras OK)';

    if (activeCount === 2) {
      reliability = 'ORANGE';
      message = 'Système Dégradé (2/3 Caméras OK — Triangulation sans redondance)';
    } else if (activeCount <= 1) {
      reliability = 'RED';
      message =
        'SYSTÈME AVEUGLE (<= 1 Caméra OK — Direction uniquement, pas de position 3D)';
    }

    return { reliability, activeCameraCount: activeCount, message };
  }

  /**
   * Main evaluation loop run every 1 second.
   */
  private evaluateCameraHealth() {
    const now = Date.now();
    const timeoutSec = Number(process.env.CAMERA_TIMEOUT_SECONDS) || 3;
    const frozenSec = Number(process.env.CAMERA_FROZEN_SECONDS) || 5;
    const blindSec = Number(process.env.CAMERA_BLIND_SECONDS) || 3;
    const recoverySec = Number(process.env.CAMERA_RECOVERY_SECONDS) || 5;

    // Detect simultaneous drops across multiple cameras (BUG NUAGE)
    let suddenDropCount = 0;
    const statuses = Array.from(this.cameraStates.values());

    for (const status of statuses) {
      const baseline = this.frozenBaselines.get(status.cameraId) || 100;
      if (status.lumMean < baseline * 0.5) {
        suddenDropCount++;
      }
    }

    const isCloudOrEnvironmental = suddenDropCount >= 2;

    for (const status of statuses) {
      const timeSinceLastSeenSec = (now - status.lastSeenMs) / 1000;
      const baseline = this.frozenBaselines.get(status.cameraId) || 100;
      const isBrutalDrop = status.lumMean < baseline * 0.5;

      let nextState: CameraState = status.state;
      let reason = status.reason;

      // Evaluation Order (Strict Priority):
      // 1. HORS_SERVICE (Silence UDP > 3s)
      if (timeSinceLastSeenSec > timeoutSec) {
        nextState = CameraState.HORS_SERVICE;
        reason = `Silence UDP (> ${timeoutSec}s sans paquet)`;
      }
      // 2. DEGRADED_BLIND (Masquée)
      else if (
        isBrutalDrop &&
        !isCloudOrEnvironmental &&
        timeSinceLastSeenSec <= timeoutSec
      ) {
        nextState = CameraState.DEGRADED_BLIND;
        reason = `Image masquée (chute de luminance individuelle vs ligne de base ${baseline.toFixed(1)})`;
      }
      // 3. REDUCED_VISIBILITY_NIGHT (Nuit / Cloud)
      else if (isBrutalDrop && isCloudOrEnvironmental) {
        nextState = CameraState.REDUCED_VISIBILITY_NIGHT;
        reason = 'Visibilité réduite (assombrissement environnemental collectif)';
      }
      // 4. RECOVERING / OK
      else if (
        status.state === CameraState.HORS_SERVICE ||
        status.state === CameraState.DEGRADED_BLIND ||
        status.state === CameraState.DEGRADED_FROZEN
      ) {
        if (timeSinceLastSeenSec <= 1) {
          nextState = CameraState.RECOVERING;
          reason = `En cours de rétablissement (hystérésis ${recoverySec}s)`;
        }
      } else if (status.state === CameraState.RECOVERING) {
        if (timeSinceLastSeenSec <= 1) {
          // If healthy for full recovery window
          nextState = CameraState.OK;
          reason = 'Fonctionnement nominal rétabli';
        }
      }

      if (nextState !== status.state) {
        status.previousState = status.state;
        status.state = nextState;
        status.reason = reason;

        const globalReliability = this.getGlobalReliability();
        this.logger.log(
          `Caméra ${status.displayName} (${status.cameraId}) : ${status.previousState} ➔ ${nextState} (${reason})`,
        );

        if (this.onStateChangeCallback) {
          this.onStateChangeCallback(status, globalReliability);
        }
      }
    }
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
