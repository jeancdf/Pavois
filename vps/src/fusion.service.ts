import { Injectable } from '@nestjs/common';
import { timeAlign, timeAlignFrameGroups } from './fusion-align';
import {
  enuToGps,
  gpsToEnu,
  makeIntrinsics,
  type CameraIntrinsics,
  type CameraPose,
  type GeoOrigin,
  type Vec3,
} from './fusion-geo';
import {
  triangulate,
  pairIntersections,
  type TriangulateObservation,
  type TriangulationResult,
} from './fusion-triangulate';
import { Tracker, type TrackerConfig } from './fusion-tracker';
import {
  FusionCameraState,
  FusionLastFuse,
  FusionObservation,
  FusionRayIntersection,
  FusionSnapshot,
  FusionTrack,
  FusionTrackUpdate,
} from './fusion.types';

interface CameraLastSeen {
  timestampUs: number;
  receivedAtMs: number;
  x: number;
  y: number;
  confidence: number;
  hasPose: boolean;
}

function toWsUpdates(
  tracks: FusionTrack[],
  origin: GeoOrigin,
): FusionTrackUpdate[] {
  const out: FusionTrackUpdate[] = [];
  for (const t of tracks) {
    const gps = enuToGps({ x: t.x, y: t.y, z: t.z }, origin);
    out.push({
      type: 'track_update',
      trackId: 'obj' + t.objectId,
      lat: gps.lat,
      lng: gps.lng,
      alt: gps.alt,
      timestamp: t.timestampUs,
      classification: t.classification || 'other',
    });
  }
  return out;
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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const value = Number.parseFloat(raw);
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

function trackerConfigFromEnv(): TrackerConfig {
  return {
    matchDistanceM: envNumber('FUSION_TRACK_MATCH_M', 6),
    processNoise: envNumber('FUSION_TRACK_PROCESS_NOISE', 200),
    measNoise: envNumber('FUSION_TRACK_MEAS_NOISE', 2.5),
    confirmUpdates: envInt('FUSION_TRACK_CONFIRM', 3),
    maxCoastMs: envInt('FUSION_TRACK_MAX_COAST_MS', 1200),
    maxSpeedMps: envNumber('FUSION_TRACK_MAX_SPEED_MPS', 120),
  };
}

function needTwoFuse(): FusionLastFuse {
  return {
    ok: false,
    rejectReason: 'need >= 2 observations',
    residualM: null,
    parallaxDeg: null,
    confidence: null,
    cameras: [],
    point: null,
  };
}

function toLastFuse(result: TriangulationResult): FusionLastFuse {
  if (!result.ok) {
    return {
      ok: false,
      rejectReason: result.rejectReason || null,
      residualM: null,
      parallaxDeg: null,
      confidence: null,
      cameras: result.cameras.slice(),
      point: null,
    };
  }
  const p = result.point;
  return {
    ok: true,
    rejectReason: null,
    residualM: result.residualM,
    parallaxDeg: result.parallaxDeg,
    confidence: result.confidence,
    cameras: result.cameras.slice(),
    point: p ? { x: p.x, y: p.y, z: p.z } : null,
  };
}

@Injectable()
export class FusionService {
  private readonly historyWindowMs = envInt('FUSION_HISTORY_MS', 2000);
  private readonly staleAfterMs = envInt('FUSION_STALE_MS', 2000);
  private readonly maxPerCamera = envInt('FUSION_MAX_PER_CAMERA', 256);
  private readonly fusionWindowMs = envInt('FUSION_WINDOW_MS', 20);
  private readonly minParallaxDeg = envNumber('FUSION_MIN_PARALLAX_DEG', 2);
  private readonly maxResidualM = envNumber('FUSION_MAX_RESIDUAL_M', 3);
  private readonly maxRangeM = envNumber('FUSION_MAX_RANGE_M', 60);
  private readonly minRangeM = envNumber('FUSION_MIN_RANGE_M', 0.5);
  private readonly deques = new Map<string, FusionObservation[]>();
  // Survivant à la purge du deque : âge / active restent lisibles.
  private readonly lastSeen = new Map<string, CameraLastSeen>();
  private lastFuse: FusionLastFuse | null = null;
  private rawIntersections: FusionRayIntersection[] = [];
  // 0 = jamais fusionné (sentinelle C++ last_fuse_us_).
  private lastFuseUs = 0;
  private readonly tracker = new Tracker(trackerConfigFromEnv());
  private tracks: FusionTrack[] = [];
  private pendingTrackUpdates: FusionTrackUpdate[] = [];
  // Origine ENU figée à la première obs GPS.
  private origin: GeoOrigin | null = null;

  ingest(obs: FusionObservation): void {
    if (!obs.cameraId) {
      return;
    }
    this.captureOrigin(obs);
    const deque = this.deques.get(obs.cameraId) ?? [];
    deque.push(obs);
    this.deques.set(obs.cameraId, deque);
    this.remember(obs);
    const nowMs = Date.now();
    for (const cameraId of [...this.deques.keys()]) {
      this.prune(cameraId, nowMs);
    }
    this.tryFuse(obs.timestampUs);
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
      lastFuse: this.lastFuse,
      rawIntersections: this.rawIntersections.slice(),
      tracks: this.tracks.slice(),
    };
  }

  history(cameraId: string): readonly FusionObservation[] {
    const deque = this.deques.get(cameraId);
    if (!deque) {
      return [];
    }
    return deque.slice();
  }

  // GPS track_update payloads from the last fuse tick. Drains the queue.
  pullTrackUpdates(): FusionTrackUpdate[] {
    const out = this.pendingTrackUpdates;
    this.pendingTrackUpdates = [];
    return out;
  }

  private tryFuse(tRefUs: number): void {
    const intervalUs = this.fusionWindowMs * 1000;
    const fusionDue =
      this.lastFuseUs === 0 || tRefUs >= this.lastFuseUs + intervalUs;

    const rawAligned = timeAlignFrameGroups(
      this.deques,
      tRefUs,
      this.fusionWindowMs,
    );
    const rawTriObs: TriangulateObservation[] = [];
    for (const item of rawAligned) {
      const mapped = this.toTriObs(item);
      if (mapped) rawTriObs.push(mapped);
    }
    this.rawIntersections =
      rawTriObs.length >= 2
        ? pairIntersections(rawTriObs, this.maxRangeM, this.minRangeM).map((intersection) => ({
            ...intersection,
            timestampUs: tRefUs,
          }))
        : [];

    // The production tracker still receives one best candidate per camera.
    // Multi-target association is intentionally not inferred from raw voxels.
    const aligned = timeAlign(this.deques, tRefUs, this.fusionWindowMs);
    if (aligned.length < 2) {
      if (fusionDue) this.lastFuse = needTwoFuse();
      return;
    }
    const triObs: TriangulateObservation[] = [];
    for (const item of aligned) {
      const mapped = this.toTriObs(item);
      if (mapped) {
        triObs.push(mapped);
      }
    }
    if (triObs.length < 2) {
      if (fusionDue) this.lastFuse = needTwoFuse();
      return;
    }
    if (!fusionDue) return;

    this.lastFuseUs = tRefUs;
    const result = triangulate(triObs, {
      minParallaxDeg: this.minParallaxDeg,
      maxResidualM: this.maxResidualM,
      maxRangeM: this.maxRangeM,
      minRangeM: this.minRangeM,
    });
    this.lastFuse = toLastFuse(result);
    this.advanceTracker(result, tRefUs);
  }

  private advanceTracker(result: TriangulationResult, tRefUs: number): void {
    if (result.ok && result.point) {
      this.tracker.update(
        result.point,
        tRefUs,
        result.confidence,
        result.cameras,
      );
    }
    this.tracks = this.tracker.tick(tRefUs);
    this.pendingTrackUpdates = this.origin
      ? toWsUpdates(this.tracks, this.origin)
      : [];
  }

  private captureOrigin(obs: FusionObservation): void {
    if (this.origin) {
      return;
    }
    if (
      isFiniteNumber(obs.lat) &&
      isFiniteNumber(obs.lon) &&
      isFiniteNumber(obs.alt)
    ) {
      this.origin = { lat: obs.lat, lon: obs.lon, alt: obs.alt };
      this.tracker.setOriginAlt(this.origin.alt);
    }
  }

  private enuOf(obs: FusionObservation): Vec3 | null {
    if (
      isFiniteNumber(obs.camX) &&
      isFiniteNumber(obs.camY) &&
      isFiniteNumber(obs.camZ)
    ) {
      return { x: obs.camX, y: obs.camY, z: obs.camZ };
    }
    if (
      !this.origin ||
      !isFiniteNumber(obs.lat) ||
      !isFiniteNumber(obs.lon) ||
      !isFiniteNumber(obs.alt)
    ) {
      return null;
    }
    return gpsToEnu(
      obs.lat,
      obs.lon,
      obs.alt,
      this.origin.lat,
      this.origin.lon,
      this.origin.alt,
    );
  }

  private toTriObs(obs: FusionObservation): TriangulateObservation | null {
    const enu = this.enuOf(obs);
    if (!enu) {
      return null;
    }
    const pose: CameraPose = {
      x: enu.x,
      y: enu.y,
      z: enu.z,
      headingDeg: isFiniteNumber(obs.headingDeg) ? obs.headingDeg : 0,
      elevationDeg: isFiniteNumber(obs.elevationDeg) ? obs.elevationDeg : 0,
      rollDeg: isFiniteNumber(obs.rollDeg) ? obs.rollDeg : 0,
    };
    const width =
      isFiniteNumber(obs.imageWidth) && obs.imageWidth > 0
        ? obs.imageWidth
        : 1280;
    const height =
      isFiniteNumber(obs.imageHeight) && obs.imageHeight > 0
        ? obs.imageHeight
        : 720;
    const fov = isFiniteNumber(obs.fovDeg) && obs.fovDeg > 0 ? obs.fovDeg : 65;
    const intrinsics: CameraIntrinsics = makeIntrinsics(width, height, fov);
    if (isFiniteNumber(obs.fx) && obs.fx > 0) {
      intrinsics.fx = obs.fx;
    }
    if (isFiniteNumber(obs.fy) && obs.fy > 0) {
      intrinsics.fy = obs.fy;
    }
    if (isFiniteNumber(obs.cx) && obs.cx > 0) {
      intrinsics.cx = obs.cx;
    }
    if (isFiniteNumber(obs.cy) && obs.cy > 0) {
      intrinsics.cy = obs.cy;
    }
    if (isFiniteNumber(obs.k1)) intrinsics.k1 = obs.k1;
    if (isFiniteNumber(obs.k2)) intrinsics.k2 = obs.k2;
    if (isFiniteNumber(obs.p1)) intrinsics.p1 = obs.p1;
    if (isFiniteNumber(obs.p2)) intrinsics.p2 = obs.p2;
    if (isFiniteNumber(obs.k3)) intrinsics.k3 = obs.k3;
    return {
      cameraId: obs.cameraId,
      pixelX: obs.x,
      pixelY: obs.y,
      quality: obs.confidence,
      pose,
      intrinsics,
    };
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
