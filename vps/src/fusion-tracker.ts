// Multi-target CV Kalman tracker. Port of pavois++ tracker.cpp.
import { KalmanCV } from './fusion-kalman';
import type { Vec3 } from './fusion-geo';
import type { FusionTrack } from './fusion.types';

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
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export class Tracker {
  private readonly cfg: TrackerConfig;
  private readonly tracks: Track[] = [];
  private nextId = 1;

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
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
    };
  }
}
