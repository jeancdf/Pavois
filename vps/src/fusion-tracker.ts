// Multi-target CV Kalman tracker. Port of pavois++ tracker.cpp, with
// Mahalanobis gating, per-measurement covariance and track re-identification.
import { KalmanCV } from './fusion-kalman';
import type { Vec3 } from './fusion-geo';
import type { FusionTrack } from './fusion.types';
import {
  classifyKinematics,
  headingDegEnu,
  headingDeltaDeg,
  isClassifiableDt,
  smoothSpeedAccel,
} from './fusion-classify';

export interface TrackerConfig {
  // Euclidean gate for tentative tracks (unknown velocity) and slack added
  // to the physically reachable distance for every track.
  matchDistanceM: number;
  processNoise: number;
  measNoise: number;
  confirmUpdates: number;
  maxCoastMs: number;
  maxSpeedMps: number;
  // Squared Mahalanobis gate for confirmed tracks (chi² 3 dof, 99%).
  gateChi2: number;
  // Floor on the measurement sigma added to a triangulation covariance.
  measFloorM: number;
}

// C++ TrackerConfig struct defaults (unit tests). FusionService env
// defaults match AppConfig (process 200, meas 2.5).
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  matchDistanceM: 6,
  processNoise: 4,
  measNoise: 1.5,
  confirmUpdates: 3,
  maxCoastMs: 1200,
  maxSpeedMps: 120,
  gateChi2: 11.34,
  measFloorM: 0.05,
};

const EMIT_GRACE_MS = 220;

export interface PredictedTrack {
  id: number;
  position: Vec3;
  // 3x3 row-major position covariance at the prediction time.
  covariance: number[];
  confirmed: boolean;
  hits: number;
  // Already received a measurement at this timestamp.
  updated: boolean;
}

interface Track {
  id: number;
  kf: KalmanCV;
  lastUpdateUs: number;
  createdUs: number;
  hits: number;
  confirmed: boolean;
  confidence: number;
  cameras: string[];
  classification: string;
  lastKineUs: number;
  lastSpeed?: number;
  lastHeading?: number;
  lastAccel: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export class Tracker {
  private readonly cfg: TrackerConfig;
  private readonly tracks: Track[] = [];
  private nextId = 1;
  // GPS MSL of the ENU origin; z is relative so alt = origin + z.
  private originAltM = 0;

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
  }

  setOriginAlt(altM: number): void {
    this.originAltM = altM;
  }

  /** Every track predicted to tsUs, confirmed first, then most hits. */
  predictAll(tsUs: number): PredictedTrack[] {
    const out: PredictedTrack[] = [];
    for (const t of this.tracks) {
      const probe = this.cloneTrack(t);
      this.predictTo(probe, tsUs);
      const p = probe.kf.position();
      out.push({
        id: t.id,
        position: { x: p[0], y: p[1], z: p[2] },
        covariance: probe.kf.positionCovariance(),
        confirmed: t.confirmed,
        hits: t.hits,
        updated: t.lastUpdateUs >= tsUs,
      });
    }
    out.sort((a, b) =>
      a.confirmed !== b.confirmed ? (a.confirmed ? -1 : 1) : b.hits - a.hits,
    );
    return out;
  }

  /**
   * Measurement already associated to track `id` (e.g. in pixel space).
   * Still gated in 3D; false when rejected so the caller can reuse it.
   */
  updateTrack(
    id: number,
    z: Vec3,
    tsUs: number,
    measConf: number,
    cameras: string[],
    measCov?: number[] | null,
  ): boolean {
    const t = this.tracks.find((track) => track.id === id);
    if (!t || t.lastUpdateUs >= tsUs) return false;
    const R = this.measCov(measCov);
    const zv = [z.x, z.y, z.z];
    if (this.gate(t, zv, tsUs, R) === null) return false;
    this.predictTo(t, tsUs);
    this.commit(t, zv, measConf, cameras, R);
    return true;
  }

  /** Nearest-neighbour association in Mahalanobis distance, else spawn. */
  update(
    z: Vec3,
    tsUs: number,
    measConf: number,
    cameras: string[],
    measCov?: number[] | null,
  ): FusionTrack | null {
    const R = this.measCov(measCov);
    const zv = [z.x, z.y, z.z];
    let best: Track | null = null;
    let bestD = Infinity;
    for (const t of this.tracks) {
      // One measurement per track and per timestamp.
      if (t.lastUpdateUs >= tsUs) continue;
      const d = this.gate(t, zv, tsUs, R);
      if (d !== null && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) {
      this.spawn(zv, tsUs, measConf, cameras, R);
      return null;
    }
    this.predictTo(best, tsUs);
    return this.commit(best, zv, measConf, cameras, R);
  }

  tick(nowUs: number): FusionTrack[] {
    const alive: FusionTrack[] = [];
    for (const t of this.tracks) {
      const sinceMs =
        nowUs > t.lastUpdateUs ? (nowUs - t.lastUpdateUs) / 1000 : 0;
      if (!t.confirmed) continue;
      if (sinceMs > EMIT_GRACE_MS) continue;
      const probe = this.cloneTrack(t);
      this.predictTo(probe, nowUs);
      if (probe.kf.speed() <= this.cfg.maxSpeedMps) {
        alive.push(this.makeUpdate(probe));
      }
    }
    this.dropCoasted(nowUs);
    return alive;
  }

  /**
   * Association cost of zv for track t, or null outside the gate: squared
   * Mahalanobis distance on the innovation covariance, capped by what the
   * target could physically have travelled. A tentative track starts with a
   * wide velocity prior (maxSpeed / 3, at least 10 m/s), so its second hit is gated loosely
   * and the third must already agree with a constant velocity: random blob
   * pairs rarely chain three times. It also keeps the Euclidean gate.
   */
  private gate(
    t: Track,
    zv: number[],
    tsUs: number,
    R: number[] | undefined,
  ): number | null {
    const probe = this.cloneTrack(t);
    this.predictTo(probe, tsUs);
    const p = probe.kf.position();
    const euclid = Math.hypot(p[0] - zv[0], p[1] - zv[1], p[2] - zv[2]);
    const dtS = Math.max(0, (tsUs - t.lastUpdateUs) / 1e6);
    const reachable = this.cfg.maxSpeedMps * dtS + this.cfg.matchDistanceM;
    if (euclid > reachable) return null;
    const d2 = probe.kf.gatingDistance(zv, R);
    if (d2 > this.cfg.gateChi2) return null;
    return t.confirmed || euclid <= this.cfg.matchDistanceM ? d2 : null;
  }

  private measCov(cov?: number[] | null): number[] | undefined {
    if (!cov || cov.length !== 9 || !cov.every(Number.isFinite)) {
      return undefined;
    }
    const floor = this.cfg.measFloorM * this.cfg.measFloorM;
    const out = cov.slice();
    out[0] += floor;
    out[4] += floor;
    out[8] += floor;
    return out;
  }

  private spawn(
    zv: number[],
    tsUs: number,
    measConf: number,
    cameras: string[],
    R: number[] | undefined,
  ): void {
    const t: Track = {
      id: this.nextId++,
      kf: new KalmanCV(),
      lastUpdateUs: tsUs,
      createdUs: tsUs,
      hits: 1,
      confirmed: false,
      confidence: measConf * 0.5,
      cameras: cameras.slice(),
      classification: 'other',
      lastKineUs: tsUs,
      lastAccel: 0,
    };
    // Start from the triangulation covariance when there is one.
    // Velocity prior wide enough for any plausible target, never below the
    // historical 10 m/s so the speed estimate still reacts fast.
    const speedSigma = Math.max(10, this.cfg.maxSpeedMps / 3);
    t.kf.init(
      3,
      zv,
      this.cfg.processNoise,
      this.cfg.measNoise,
      R,
      speedSigma * speedSigma,
    );
    this.tracks.push(t);
  }

  private commit(
    best: Track,
    zv: number[],
    measConf: number,
    cameras: string[],
    R: number[] | undefined,
  ): FusionTrack | null {
    best.kf.update(zv, R);
    best.hits += 1;
    best.cameras = cameras.slice();
    best.confidence = clamp(
      0.6 * best.confidence + 0.4 * measConf + 0.02 * Math.min(10, best.hits),
      0,
      0.99,
    );
    if (
      !best.confirmed &&
      best.hits >= this.cfg.confirmUpdates &&
      best.kf.speed() <= this.cfg.maxSpeedMps
    ) {
      best.confirmed = true;
      this.reidentify(best);
    }
    this.applyKineClass(best);
    return best.confirmed ? this.makeUpdate(best) : null;
  }

  /**
   * A freshly confirmed track that appears where a confirmed track was lost
   * takes over its id, so a gap does not change identity. Replaces the old
   * in-place Kalman reset, which let one stray point teleport a live track.
   */
  private reidentify(fresh: Track): void {
    const recoveryGate = Math.max(this.cfg.matchDistanceM * 3, 12);
    const p = fresh.kf.position();
    let lost: Track | null = null;
    let lostD = recoveryGate;
    for (const t of this.tracks) {
      if (t === fresh || !t.confirmed) continue;
      // Only a track that went silent before the fresh one was born.
      if (t.lastUpdateUs >= fresh.createdUs) continue;
      const probe = this.cloneTrack(t);
      this.predictTo(probe, fresh.lastUpdateUs);
      const q = probe.kf.position();
      const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (d <= lostD) {
        lostD = d;
        lost = t;
      }
    }
    if (!lost) return;
    fresh.id = lost.id;
    this.tracks.splice(this.tracks.indexOf(lost), 1);
  }

  private dropCoasted(nowUs: number): void {
    const kept: Track[] = [];
    for (const t of this.tracks) {
      const coastMs =
        nowUs > t.lastUpdateUs ? (nowUs - t.lastUpdateUs) / 1000 : 0;
      if (coastMs <= this.cfg.maxCoastMs) kept.push(t);
    }
    this.tracks.length = 0;
    this.tracks.push(...kept);
  }

  private predictTo(t: Track, nowUs: number): void {
    if (nowUs <= t.lastUpdateUs) return;
    const dt = (nowUs - t.lastUpdateUs) / 1e6;
    t.kf.predict(dt);
    t.lastUpdateUs = nowUs;
  }

  private makeUpdate(t: Track): FusionTrack {
    const p = t.kf.position();
    return {
      objectId: t.id,
      timestampUs: t.lastUpdateUs,
      x: p[0],
      y: p[1],
      z: p[2],
      confidence: t.confidence,
      cameras: t.cameras.slice(),
      classification: t.classification || 'other',
    };
  }

  private cloneTrack(t: Track): Track {
    return {
      id: t.id,
      kf: t.kf.clone(),
      lastUpdateUs: t.lastUpdateUs,
      createdUs: t.createdUs,
      hits: t.hits,
      confirmed: t.confirmed,
      confidence: t.confidence,
      cameras: t.cameras.slice(),
      classification: t.classification,
      lastKineUs: t.lastKineUs,
      lastSpeed: t.lastSpeed,
      lastHeading: t.lastHeading,
      lastAccel: t.lastAccel,
    };
  }

  // Scorecard v2 on Kalman speed / accel / heading, GPS alt = origin + z.
  private applyKineClass(t: Track): void {
    const dtS = (t.lastUpdateUs - t.lastKineUs) / 1e6;
    t.lastKineUs = t.lastUpdateUs;
    if (!isClassifiableDt(dtS)) {
      return;
    }
    const vel = t.kf.velocity();
    const rawSpeed = t.kf.speed();
    const heading = headingDegEnu(vel[0], vel[1]);
    const filtered = smoothSpeedAccel(
      { speed: t.lastSpeed, accel: t.lastAccel },
      rawSpeed,
      dtS,
    );
    const speed = filtered.speed ?? rawSpeed;
    const accel = filtered.accel;
    let headingRate = 0;
    if (t.lastHeading !== undefined && speed >= 0.5) {
      headingRate = headingDeltaDeg(t.lastHeading, heading) / dtS;
    }
    const pos = t.kf.position();
    const scored = classifyKinematics({
      speedMps: speed,
      accelMps2: accel,
      altM: this.originAltM + pos[2],
      headingChangeDegPerS: headingRate,
      priorAccelMps2: t.lastAccel,
    });
    t.classification = scored.classification;
    t.lastSpeed = speed;
    t.lastAccel = accel;
    if (speed >= 0.5) {
      t.lastHeading = heading;
    }
  }
}
