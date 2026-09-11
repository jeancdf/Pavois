// Multi-target CV Kalman tracker. Port of pavois++ tracker.cpp.
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
  matchDistanceM: number;
  processNoise: number;
  measNoise: number;
  confirmUpdates: number;
  maxCoastMs: number;
  maxSpeedMps: number;
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
};

const EMIT_GRACE_MS = 220;

interface Track {
  id: number;
  kf: KalmanCV;
  lastUpdateUs: number;
  createdUs: number;
  hits: number;
  misses: number;
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

  update(
    z: Vec3,
    tsUs: number,
    measConf: number,
    cameras: string[],
  ): FusionTrack | null {
    const zv = [z.x, z.y, z.z];
    const found = this.nearest(z, tsUs);
    const normalGate = this.cfg.matchDistanceM;
    const recoveryGate = Math.max(this.cfg.matchDistanceM * 3, 12);
    if (!found.best || found.bestD > recoveryGate) {
      this.spawn(zv, tsUs, measConf, cameras);
      return null;
    }
    const best = found.best;
    this.predictTo(best, tsUs);
    best.lastUpdateUs = tsUs;
    if (found.bestD > normalGate) {
      return this.recover(best, zv, measConf, cameras);
    }
    return this.commit(best, zv, measConf, cameras);
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

  private nearest(
    z: Vec3,
    tsUs: number,
  ): { best: Track | null; bestD: number } {
    let best: Track | null = null;
    let bestD = 1e18;
    for (const t of this.tracks) {
      const probe = this.cloneTrack(t);
      this.predictTo(probe, tsUs);
      const pp = probe.kf.position();
      const euclid = Math.hypot(pp[0] - z.x, pp[1] - z.y, pp[2] - z.z);
      if (euclid < bestD) {
        bestD = euclid;
        best = t;
      }
    }
    return { best, bestD };
  }

  private spawn(
    zv: number[],
    tsUs: number,
    measConf: number,
    cameras: string[],
  ): void {
    const t: Track = {
      id: this.nextId++,
      kf: new KalmanCV(),
      lastUpdateUs: tsUs,
      createdUs: tsUs,
      hits: 1,
      misses: 0,
      confirmed: false,
      confidence: measConf * 0.5,
      cameras: cameras.slice(),
      classification: 'other',
      lastKineUs: tsUs,
      lastAccel: 0,
    };
    t.kf.init(3, zv, this.cfg.processNoise, this.cfg.measNoise);
    this.tracks.push(t);
  }

  private recover(
    best: Track,
    zv: number[],
    measConf: number,
    cameras: string[],
  ): FusionTrack | null {
    best.kf.init(3, zv, this.cfg.processNoise, this.cfg.measNoise);
    best.hits = Math.max(best.hits, this.cfg.confirmUpdates);
    best.cameras = cameras.slice();
    best.confidence = clamp(0.5 * best.confidence + 0.3 * measConf, 0, 0.9);
    this.resetKine(best);
    return best.confirmed ? this.makeUpdate(best) : null;
  }

  private commit(
    best: Track,
    zv: number[],
    measConf: number,
    cameras: string[],
  ): FusionTrack | null {
    best.kf.update(zv);
    best.hits += 1;
    best.misses = 0;
    best.cameras = cameras.slice();
    best.confidence = clamp(
      0.6 * best.confidence + 0.4 * measConf + 0.02 * Math.min(10, best.hits),
      0,
      0.99,
    );
    if (
      best.hits >= this.cfg.confirmUpdates &&
      best.kf.speed() <= this.cfg.maxSpeedMps
    ) {
      best.confirmed = true;
    }
    this.applyKineClass(best);
    return best.confirmed ? this.makeUpdate(best) : null;
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
      misses: t.misses,
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

  private resetKine(t: Track): void {
    t.classification = 'other';
    t.lastKineUs = t.lastUpdateUs;
    t.lastSpeed = undefined;
    t.lastHeading = undefined;
    t.lastAccel = 0;
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
