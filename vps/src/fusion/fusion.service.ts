import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createWriteStream, type WriteStream } from 'fs';
import { alignCandidates, timeAlignFrameGroups } from '../fusion-align';
import {
  enuToGps,
  gpsToEnu,
  makeIntrinsics,
  projectWorldToPixel,
  reprojectionErrorPx,
  vNorm,
  vSub,
  type CameraIntrinsics,
  type CameraPose,
  type GeoOrigin,
  type Vec3,
} from '../fusion-geo';
import {
  DEFAULT_TRIANGULATION_CONFIG,
  triangulate,
  pairIntersections,
  type TriangulateObservation,
  type TriangulationConfig,
  type TriangulationResult,
} from '../fusion-triangulate';
import {
  DEFAULT_TRACKER_CONFIG,
  Tracker,
  type PredictedTrack,
  type TrackerConfig,
} from '../fusion-tracker';
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

/** Settings an operator can change while the engine runs. */
export interface FusionTuning {
  maxResidualPx: number;
  minParallaxDeg: number;
  minRangeM: number;
  maxRangeM: number;
  assocGatePx: number;
  pairGatePx: number;
  maxBlobsPerCamera: number;
  maxTargets: number;
  intervalMs: number;
  latencyMs: number;
  confirmUpdates: number;
  maxCoastMs: number;
  gateChi2: number;
  matchDistanceM: number;
  maxSpeedMps: number;
  processNoise: number;
}

/** One blob of one camera at the fusion tick, ready to triangulate. */
interface Candidate {
  cameraId: string;
  confidence: number;
  tri: TriangulateObservation;
  used: boolean;
}

// Bounds the work one ingest can trigger when data arrives in a burst.
const MAX_TICKS_PER_INGEST = 64;
const NO_SUBSET = 'no subset passed parallax/residual gates';

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
    gateChi2: envNumber(
      'FUSION_TRACK_GATE_CHI2',
      DEFAULT_TRACKER_CONFIG.gateChi2,
    ),
    measFloorM: envNumber(
      'FUSION_TRACK_MEAS_FLOOR_M',
      DEFAULT_TRACKER_CONFIG.measFloorM,
    ),
  };
}

function triangulationConfigFromEnv(): TriangulationConfig {
  const d = DEFAULT_TRIANGULATION_CONFIG;
  return {
    minParallaxDeg: envNumber('FUSION_MIN_PARALLAX_DEG', d.minParallaxDeg),
    maxResidualPx: envNumber('FUSION_MAX_RESIDUAL_PX', d.maxResidualPx),
    maxResidualM: envNumber('FUSION_MAX_RESIDUAL_M', d.maxResidualM),
    maxRangeM: envNumber('FUSION_MAX_RANGE_M', d.maxRangeM),
    minRangeM: envNumber('FUSION_MIN_RANGE_M', d.minRangeM),
    pixelSigma: envNumber('FUSION_PIXEL_SIGMA', d.pixelSigma),
    poseSigmaDeg: envNumber('FUSION_POSE_SIGMA_DEG', d.poseSigmaDeg),
  };
}

function needTwoFuse(): FusionLastFuse {
  return {
    ok: false,
    rejectReason: 'need >= 2 observations',
    residualM: null,
    residualPx: null,
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
      residualPx: null,
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
    residualPx: result.residualPx,
    parallaxDeg: result.parallaxDeg,
    confidence: result.confidence,
    cameras: result.cameras.slice(),
    point: p ? { x: p.x, y: p.y, z: p.z } : null,
  };
}

/** Most cameras first, then the most confident solution. */
function betterFuse(a: TriangulationResult, b: TriangulationResult): boolean {
  if (a.cameras.length !== b.cameras.length) {
    return a.cameras.length > b.cameras.length;
  }
  return a.confidence > b.confidence;
}

/** Predicted track spread projected in pixels, for the association gate. */
function projectedSigmaPx(track: PredictedTrack, c: Candidate): number {
  const cov = track.covariance;
  const sigmaM = Math.sqrt(Math.max(0, (cov[0] + cov[4] + cov[8]) / 3));
  const pose = c.tri.pose;
  const range = vNorm(
    vSub(track.position, { x: pose.x, y: pose.y, z: pose.z }),
  );
  const f = 0.5 * (c.tri.intrinsics.fx + c.tri.intrinsics.fy);
  return range > 1e-6 ? (f * sigmaM) / range : Infinity;
}

/**
 * Multi-camera fusion on the VPS.
 *
 * Fusion runs on a fixed time grid (FUSION_INTERVAL_MS) held back until
 * every recently active camera has a frame at or after the tick, or until
 * FUSION_LATENCY_MS of newer data has arrived. The other Pi frames for the
 * same instant are then already here, so each camera is interpolated
 * instead of extrapolated.
 *
 * At each tick, blobs are first assigned to existing tracks by projecting
 * each predicted track into every camera; the remaining blobs form new
 * candidates (pairs extended by the third camera). Every target is
 * triangulated on its own, with a covariance handed to the Kalman filter.
 */
@Injectable()
export class FusionService implements OnModuleDestroy {
  private readonly historyWindowMs = envInt('FUSION_HISTORY_MS', 2000);
  private readonly staleAfterMs = envInt('FUSION_STALE_MS', 2000);
  private readonly maxPerCamera = envInt('FUSION_MAX_PER_CAMERA', 256);
  private readonly fusionWindowMs = envInt('FUSION_WINDOW_MS', 20);
  // The settings below start from the environment and can then be changed
  // at run time through applyTuning().
  // One fusion per camera frame: the Pis capture at 30 fps. Keep it at the
  // capture period; a longer one updates tracks less often than they are seen.
  private intervalMs = envInt('FUSION_INTERVAL_MS', 33);
  private latencyMs = envInt('FUSION_LATENCY_MS', 80);
  private assocGatePx = envNumber('FUSION_ASSOC_GATE_PX', 40);
  private pairGatePx = envNumber('FUSION_PAIR_GATE_PX', 60);
  private maxBlobsPerCamera = envInt('FUSION_MAX_BLOBS_PER_CAMERA', 8);
  private maxTargets = envInt('FUSION_MAX_TARGETS', 8);
  private readonly triCfg = triangulationConfigFromEnv();
  private readonly deques = new Map<string, FusionObservation[]>();
  // Survivant à la purge du deque : âge / active restent lisibles.
  private readonly lastSeen = new Map<string, CameraLastSeen>();
  private lastFuse: FusionLastFuse | null = null;
  private rawIntersections: FusionRayIntersection[] = [];
  // Next grid time to fuse at; null until the first observation.
  private nextTickUs: number | null = null;
  private readonly tracker = new Tracker(trackerConfigFromEnv());
  private tracks: FusionTrack[] = [];
  private pendingTrackUpdates: FusionTrackUpdate[] = [];
  // Origine ENU figée à la première obs GPS.
  private origin: GeoOrigin | null = null;
  // JSONL of every observation, for offline replay (scripts/fusion-replay).
  private readonly recorder: WriteStream | null = this.openRecorder();

  ingest(obs: FusionObservation, nowMs = Date.now()): void {
    if (!obs.cameraId) {
      return;
    }
    this.recorder?.write(JSON.stringify(obs) + '\n');
    this.captureOrigin(obs);
    const deque = this.deques.get(obs.cameraId) ?? [];
    deque.push(obs);
    this.deques.set(obs.cameraId, deque);
    this.remember(obs);
    for (const cameraId of [...this.deques.keys()]) {
      this.prune(cameraId, nowMs);
    }
    this.updateRawIntersections(obs.timestampUs);
    this.processTicks(obs.timestampUs);
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

  tuning(): FusionTuning {
    const tracker = this.tracker.config();
    return {
      maxResidualPx: this.triCfg.maxResidualPx,
      minParallaxDeg: this.triCfg.minParallaxDeg,
      minRangeM: this.triCfg.minRangeM,
      maxRangeM: this.triCfg.maxRangeM,
      assocGatePx: this.assocGatePx,
      pairGatePx: this.pairGatePx,
      maxBlobsPerCamera: this.maxBlobsPerCamera,
      maxTargets: this.maxTargets,
      intervalMs: this.intervalMs,
      latencyMs: this.latencyMs,
      confirmUpdates: tracker.confirmUpdates,
      maxCoastMs: tracker.maxCoastMs,
      gateChi2: tracker.gateChi2,
      matchDistanceM: tracker.matchDistanceM,
      maxSpeedMps: tracker.maxSpeedMps,
      processNoise: tracker.processNoise,
    };
  }

  /**
   * Changes settings between two fusion ticks. Live tracks are kept; the
   * caller validates the values, anything that is not a number is ignored.
   */
  applyTuning(values: Partial<FusionTuning>): void {
    const next = this.tuning();
    for (const key of Object.keys(next) as (keyof FusionTuning)[]) {
      const value = values[key];
      if (isFiniteNumber(value)) next[key] = value;
    }
    this.triCfg.maxResidualPx = next.maxResidualPx;
    this.triCfg.minParallaxDeg = next.minParallaxDeg;
    this.triCfg.minRangeM = next.minRangeM;
    this.triCfg.maxRangeM = next.maxRangeM;
    this.assocGatePx = next.assocGatePx;
    this.pairGatePx = next.pairGatePx;
    this.maxBlobsPerCamera = next.maxBlobsPerCamera;
    this.maxTargets = next.maxTargets;
    this.intervalMs = next.intervalMs;
    this.latencyMs = next.latencyMs;
    this.tracker.configure({
      confirmUpdates: next.confirmUpdates,
      maxCoastMs: next.maxCoastMs,
      gateChi2: next.gateChi2,
      matchDistanceM: next.matchDistanceM,
      maxSpeedMps: next.maxSpeedMps,
      processNoise: next.processNoise,
    });
  }

  onModuleDestroy(): void {
    this.recorder?.end();
  }

  private openRecorder(): WriteStream | null {
    const path = process.env.FUSION_RECORD_PATH;
    if (!path) return null;
    const stream = createWriteStream(path, { flags: 'a' });
    stream.on('error', (err) => {
      console.warn(`[FUSION] enregistrement impossible (${path}) :`, err);
    });
    return stream;
  }

  // Rail debug view: every blob pair of the frames nearest to the newest
  // observation, before any gate. Geometry samples, never tracks.
  private updateRawIntersections(tRefUs: number): void {
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
        ? pairIntersections(
            rawTriObs,
            this.triCfg.maxRangeM,
            this.triCfg.minRangeM,
          ).map((intersection) => ({ ...intersection, timestampUs: tRefUs }))
        : [];
  }

  private processTicks(firstUs: number): void {
    if (this.deques.size === 0) return;
    const latencyUs = this.latencyMs * 1000;
    const intervalUs = this.intervalMs * 1000;
    let watermark = -Infinity;
    for (const deque of this.deques.values()) {
      watermark = Math.max(watermark, latestTimestampUs(deque));
    }
    let tickUs: number = this.nextTickUs ?? firstUs;
    // After a long silence, resume near the newest data instead of
    // replaying every empty tick of the gap.
    if (watermark - tickUs > this.historyWindowMs * 1000) {
      tickUs = watermark - latencyUs;
    }
    this.nextTickUs = tickUs;
    for (let guard = 0; guard < MAX_TICKS_PER_INGEST; guard++) {
      const late = watermark >= tickUs + latencyUs;
      if (!late && !this.allCovered(tickUs, latencyUs)) return;
      if (!this.fuseTick(tickUs, late)) return;
      tickUs += intervalUs;
      this.nextTickUs = tickUs;
    }
    this.nextTickUs = Math.max(tickUs, watermark - latencyUs);
  }

  // Every camera that reported recently has a frame at or after the tick.
  // A camera silent for longer than the latency (target out of its view)
  // is not waited for.
  private allCovered(tickUs: number, latencyUs: number): boolean {
    for (const deque of this.deques.values()) {
      const latest = latestTimestampUs(deque);
      if (latest < tickUs - latencyUs) continue;
      if (latest < tickUs) return false;
    }
    return true;
  }

  /** False when the tick must wait for more data (not consumed). */
  private fuseTick(tickUs: number, late: boolean): boolean {
    const cands = this.candidatesAt(tickUs);
    if (cands.size < 2) {
      this.lastFuse = needTwoFuse();
      if (!late) return false;
      this.advanceTracker(tickUs);
      return true;
    }

    const applied: TriangulationResult[] = [];
    this.associateTracks(
      this.tracker.predictAll(tickUs),
      cands,
      tickUs,
      applied,
    );
    this.spawnFromLeftovers(cands, tickUs, applied);

    let best: TriangulationResult | null = null;
    for (const r of applied) {
      if (!best || betterFuse(r, best)) best = r;
    }
    this.lastFuse = best
      ? toLastFuse(best)
      : {
          ...needTwoFuse(),
          rejectReason: NO_SUBSET,
          cameras: [...cands.keys()],
        };
    this.advanceTracker(tickUs);
    return true;
  }

  private candidatesAt(tickUs: number): Map<string, Candidate[]> {
    const aligned = alignCandidates(
      this.deques,
      tickUs,
      this.fusionWindowMs,
      this.pairGatePx,
    );
    const out = new Map<string, Candidate[]>();
    for (const [cameraId, blobs] of aligned) {
      const list: Candidate[] = [];
      for (const obs of blobs) {
        const tri = this.toTriObs(obs);
        if (tri)
          list.push({ cameraId, confidence: obs.confidence, tri, used: false });
      }
      list.sort((a, b) => b.confidence - a.confidence);
      if (list.length > 0)
        out.set(cameraId, list.slice(0, this.maxBlobsPerCamera));
    }
    return out;
  }

  /**
   * Track-driven association: each predicted track is projected into every
   * camera and takes the nearest free blob, one blob per track and camera.
   */
  private associateTracks(
    predicted: PredictedTrack[],
    cands: Map<string, Candidate[]>,
    tickUs: number,
    applied: TriangulationResult[],
  ): void {
    const live = predicted.filter((t) => !t.updated);
    if (live.length === 0) return;
    const assigned = live.map(() => [] as Candidate[]);
    for (const list of cands.values()) {
      const pairs: { track: number; cand: Candidate; d: number }[] = [];
      live.forEach((track, ti) => {
        for (const cand of list) {
          const proj = projectWorldToPixel(
            cand.tri.intrinsics,
            cand.tri.pose,
            track.position,
          );
          if (!proj) continue;
          const d = Math.hypot(
            proj[0] - cand.tri.pixelX,
            proj[1] - cand.tri.pixelY,
          );
          const gate = Math.max(
            this.assocGatePx,
            3 * projectedSigmaPx(track, cand),
          );
          if (d <= gate) pairs.push({ track: ti, cand, d });
        }
      });
      pairs.sort((a, b) => a.d - b.d);
      const takenTracks = new Set<number>();
      const takenCands = new Set<Candidate>();
      for (const p of pairs) {
        if (takenTracks.has(p.track) || takenCands.has(p.cand)) continue;
        takenTracks.add(p.track);
        takenCands.add(p.cand);
        assigned[p.track].push(p.cand);
      }
    }

    live.forEach((track, ti) => {
      const mine = assigned[ti];
      if (mine.length >= 2) {
        const r = triangulate(
          mine.map((c) => c.tri),
          this.triCfg,
        );
        if (
          r.ok &&
          r.point &&
          this.tracker.updateTrack(
            track.id,
            r.point,
            tickUs,
            r.confidence,
            r.cameras,
            r.covariance,
          )
        ) {
          for (const i of r.inliers) mine[i].used = true;
          applied.push(r);
          return;
        }
      }
      // A confirmed target seen by one camera only still explains that
      // blob: keep it out of new-target pairing to avoid ghosts.
      if (track.confirmed && mine.length === 1) mine[0].used = true;
    });
  }

  /**
   * New targets from blobs no track explained: every cross-camera pair is
   * triangulated, extended with the best-agreeing blob of the other
   * cameras, then picked greedily (most cameras, lowest residual).
   */
  private spawnFromLeftovers(
    cands: Map<string, Candidate[]>,
    tickUs: number,
    applied: TriangulationResult[],
  ): void {
    const free = new Map<string, Candidate[]>();
    for (const [cameraId, list] of cands) {
      const left = list.filter((c) => !c.used);
      if (left.length > 0) free.set(cameraId, left);
    }
    const cams = [...free.keys()];
    if (cams.length < 2) return;

    const proposals: { members: Candidate[]; result: TriangulationResult }[] =
      [];
    for (let a = 0; a < cams.length; a++) {
      for (let b = a + 1; b < cams.length; b++) {
        for (const ca of free.get(cams[a])!) {
          for (const cb of free.get(cams[b])!) {
            const proposal = this.propose([ca, cb], cams, free);
            if (proposal) proposals.push(proposal);
          }
        }
      }
    }
    proposals.sort((x, y) =>
      x.members.length !== y.members.length
        ? y.members.length - x.members.length
        : x.result.residualPx - y.result.residualPx,
    );

    let spawned = 0;
    for (const { members, result } of proposals) {
      if (spawned >= this.maxTargets) break;
      if (members.some((m) => m.used)) continue;
      for (const m of members) m.used = true;
      this.tracker.update(
        result.point!,
        tickUs,
        result.confidence,
        result.cameras,
        result.covariance,
      );
      applied.push(result);
      spawned += 1;
    }
  }

  private propose(
    pair: Candidate[],
    cams: string[],
    free: Map<string, Candidate[]>,
  ): { members: Candidate[]; result: TriangulationResult } | null {
    const r2 = triangulate(
      pair.map((c) => c.tri),
      this.triCfg,
    );
    if (!r2.ok || !r2.point) return null;
    const members = pair.slice();
    for (const cam of cams) {
      if (cam === pair[0].cameraId || cam === pair[1].cameraId) continue;
      let best: Candidate | null = null;
      let bestErr = this.triCfg.maxResidualPx;
      for (const c of free.get(cam)!) {
        const e = reprojectionErrorPx(
          c.tri.intrinsics,
          c.tri.pose,
          r2.point,
          c.tri.pixelX,
          c.tri.pixelY,
        );
        if (e !== null && e <= bestErr) {
          bestErr = e;
          best = c;
        }
      }
      if (best) members.push(best);
    }
    if (members.length === 2) {
      return this.contradicted(r2.point, pair, cams, free)
        ? null
        : { members, result: r2 };
    }
    const r = triangulate(
      members.map((c) => c.tri),
      this.triCfg,
    );
    if (!r.ok || !r.point) {
      return this.contradicted(r2.point, pair, cams, free)
        ? null
        : { members: pair, result: r2 };
    }
    return { members: r.inliers.map((i) => members[i]), result: r };
  }

  /**
   * Negative evidence against a two-camera ghost: another camera that is
   * reporting blobs at this tick, and whose image contains the point, has
   * none that agrees with it. Cameras that sent nothing prove nothing.
   */
  private contradicted(
    point: Vec3,
    pair: Candidate[],
    cams: string[],
    free: Map<string, Candidate[]>,
  ): boolean {
    for (const cam of cams) {
      if (cam === pair[0].cameraId || cam === pair[1].cameraId) continue;
      const any = free.get(cam)![0];
      const intr = any.tri.intrinsics;
      const proj = projectWorldToPixel(intr, any.tri.pose, point);
      if (
        proj &&
        proj[0] >= 0 &&
        proj[1] >= 0 &&
        proj[0] < intr.imageWidth &&
        proj[1] < intr.imageHeight
      ) {
        return true;
      }
    }
    return false;
  }

  private advanceTracker(tickUs: number): void {
    this.tracks = this.tracker.tick(tickUs);
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
    // No heading = no pose: a ray assumed to face north is worse than none.
    if (!isFiniteNumber(obs.headingDeg)) {
      return null;
    }
    const enu = this.enuOf(obs);
    if (!enu) {
      return null;
    }
    const pose: CameraPose = {
      x: enu.x,
      y: enu.y,
      z: enu.z,
      headingDeg: obs.headingDeg,
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
    if (kept.length > this.maxPerCamera) {
      kept.splice(0, kept.length - this.maxPerCamera);
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
