import { Injectable } from '@nestjs/common';
import {
  FusionCameraState,
  FusionObservation,
  FusionSnapshot,
} from './fusion.types';

interface CameraLastSeen {
  timestampUs: number;
  receivedAtMs: number;
  x: number;
  y: number;
  confidence: number;
  hasPose: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function latestTimestampUs(deque: FusionObservation[]): number {
  let latest = deque[0].timestampUs;
  for (const obs of deque) {
    if (obs.timestampUs > latest) {
      latest = obs.timestampUs;
    }
  }
  return latest;
}

@Injectable()
export class FusionService {
  private readonly historyWindowMs = envInt('FUSION_HISTORY_MS', 2000);
  private readonly staleAfterMs = envInt('FUSION_STALE_MS', 2000);
  private readonly maxPerCamera = envInt('FUSION_MAX_PER_CAMERA', 256);
  private readonly deques = new Map<string, FusionObservation[]>();
  // Survivant à la purge du deque : âge / active restent lisibles.
  private readonly lastSeen = new Map<string, CameraLastSeen>();

  ingest(obs: FusionObservation): void {
    if (!obs.cameraId) {
      return;
    }
    const deque = this.deques.get(obs.cameraId) ?? [];
    deque.push(obs);
    this.deques.set(obs.cameraId, deque);
    this.remember(obs);
    const nowMs = Date.now();
    for (const cameraId of [...this.deques.keys()]) {
      this.prune(cameraId, nowMs);
    }
  }

  snapshot(nowMs = Date.now()): FusionSnapshot {
    const cameras: FusionCameraState[] = [];
    for (const [cameraId, seen] of this.lastSeen) {
      const state = this.cameraState(cameraId, seen, nowMs);
      if (!state) {
        continue;
      }
      cameras.push(state);
    }
    cameras.sort((a, b) => a.cameraId.localeCompare(b.cameraId));
    let activeCameras = 0;
    for (const camera of cameras) {
      if (camera.active) {
        activeCameras += 1;
      }
    }
    return {
      activeCameras,
      cameraCount: cameras.length,
      historyWindowMs: this.historyWindowMs,
      staleAfterMs: this.staleAfterMs,
      cameras,
    };
  }

  history(cameraId: string): readonly FusionObservation[] {
    const deque = this.deques.get(cameraId);
    if (!deque) {
      return [];
    }
    return deque.slice();
  }

  private remember(obs: FusionObservation): void {
    const prev = this.lastSeen.get(obs.cameraId);
    if (prev && obs.receivedAtMs < prev.receivedAtMs) {
      return;
    }
    this.lastSeen.set(obs.cameraId, {
      timestampUs: obs.timestampUs,
      receivedAtMs: obs.receivedAtMs,
      x: obs.x,
      y: obs.y,
      confidence: obs.confidence,
      hasPose: isFiniteNumber(obs.headingDeg),
    });
  }

  private prune(cameraId: string, nowMs: number): void {
    const deque = this.deques.get(cameraId);
    if (!deque || deque.length === 0) {
      this.deques.delete(cameraId);
      return;
    }

    // Relatif au plus récent de CETTE caméra (unix-us ou compteur boot).
    const keepUs = this.historyWindowMs * 1000;
    const minUs = latestTimestampUs(deque) - keepUs;
    const minRecv = nowMs - this.historyWindowMs;
    const kept: FusionObservation[] = [];
    for (const item of deque) {
      if (item.timestampUs >= minUs && item.receivedAtMs >= minRecv) {
        kept.push(item);
      }
    }
    while (kept.length > this.maxPerCamera) {
      kept.shift();
    }
    if (kept.length === 0) {
      this.deques.delete(cameraId);
    } else {
      this.deques.set(cameraId, kept);
    }
  }

  private cameraState(
    cameraId: string,
    seen: CameraLastSeen,
    nowMs: number,
  ): FusionCameraState | null {
    const deque = this.deques.get(cameraId);
    const detectionCount = deque ? deque.length : 0;
    const ageMs = nowMs - seen.receivedAtMs;
    const active = ageMs <= this.staleAfterMs;
    if (detectionCount === 0 && !active) {
      return null;
    }
    return {
      cameraId,
      detectionCount,
      lastTimestampUs: seen.timestampUs,
      lastReceivedAtMs: seen.receivedAtMs,
      ageMs,
      active,
      hasPose: seen.hasPose,
      lastX: seen.x,
      lastY: seen.y,
      lastConfidence: seen.confidence,
    };
  }
}
