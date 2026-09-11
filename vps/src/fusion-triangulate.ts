import type { CameraIntrinsics, CameraPose, Ray, Vec3 } from './fusion-geo';
import {
  leastSquaresIntersection,
  minPairwiseAngleDeg,
  pixelToRay,
  rayResidual,
  vDot,
  vNorm,
  vSub,
} from './fusion-geo';

export interface TriangulationConfig {
  minParallaxDeg: number; // default 2
  maxResidualM: number; // default 3
  maxRangeM: number; // default 60
}

export interface TriangulateObservation {
  cameraId: string;
  pixelX: number;
  pixelY: number;
  quality: number; // [0,1], used as weight max(0.05, quality)
  pose: CameraPose;
  intrinsics: CameraIntrinsics;
}

export interface TriangulationResult {
  ok: boolean;
  point: Vec3 | null;
  residualM: number;
  parallaxDeg: number;
  confidence: number;
  cameras: string[];
  rejectReason: string;
}

const DEFAULT_CFG: TriangulationConfig = {
  minParallaxDeg: 2,
  maxResidualM: 3,
  maxRangeM: 60,
};

const NEED_OBS = 'need >= 2 observations';
const NO_SUBSET = 'no subset passed parallax/residual gates';

interface Solve {
  ok: boolean;
  point: Vec3 | null;
  residual: number;
  maxResidual: number;
  parallax: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rejected(reason: string): TriangulationResult {
  return {
    ok: false,
    point: null,
    residualM: 0,
    parallaxDeg: 0,
    confidence: 0,
    cameras: [],
    rejectReason: reason,
  };
}

function solveSubset(
  obs: TriangulateObservation[],
  idx: number[],
  maxRangeM: number,
): Solve {
  const s: Solve = {
    ok: false,
    point: null,
    residual: 0,
    maxResidual: 0,
    parallax: 0,
  };
  const rays: Ray[] = [];
  const weights: number[] = [];
  for (const i of idx) {
    const o = obs[i];
    rays.push(pixelToRay(o.intrinsics, o.pose, o.pixelX, o.pixelY));
    weights.push(Math.max(0.05, o.quality));
  }
  const p = leastSquaresIntersection(rays, weights);
  if (!p) return s;

  // Cheirality: the point must be in front of every camera.
  for (const r of rays) {
    const toP = vSub(p, r.origin);
    if (vDot(toP, r.direction) <= 0) return s;
    if (maxRangeM > 0 && vNorm(toP) > maxRangeM * 1.5) return s;
  }

  let rsum = 0;
  for (const r of rays) {
    const rr = rayResidual(r, p);
    rsum += rr;
    s.maxResidual = Math.max(s.maxResidual, rr);
  }
  s.residual = rsum / rays.length;
  s.parallax = minPairwiseAngleDeg(rays);
  s.point = p;
  s.ok = true;
  return s;
}

export function triangulate(
  obs: TriangulateObservation[],
  cfg?: Partial<TriangulationConfig>,
): TriangulationResult {
  const c: TriangulationConfig = { ...DEFAULT_CFG, ...cfg };
  if (obs.length < 2) {
    return rejected(NEED_OBS);
  }

  const all: number[] = [];
  for (let i = 0; i < obs.length; i++) all.push(i);

  let bestSet: number[] = [];
  let best: Solve = {
    ok: false,
    point: null,
    residual: 0,
    maxResidual: 0,
    parallax: 0,
  };
  let bestScore = -1;

  const consider = (idx: number[]): void => {
    if (idx.length < 2) return;
    const s = solveSubset(obs, idx, c.maxRangeM);
    if (!s.ok) return;
    if (s.parallax < c.minParallaxDeg) return;
    // Every contributing ray must agree with the solution, not just on
    // average -- this is what forces a lone bad blob out of the inlier set.
    if (s.maxResidual > c.maxResidualM) return;
    // Prefer more inliers, then lower residual.
    const score = idx.length * 100 - s.residual;
    if (score > bestScore) {
      bestScore = score;
      bestSet = idx;
      best = s;
    }
  };

  consider(all);

  // RANSAC-lite: for 3+ cameras, also try every leave-one-out subset so a
  // single bad blob cannot drag the solution.
  if (obs.length >= 3) {
    for (let drop = 0; drop < obs.length; drop++) {
      const sub: number[] = [];
      for (let i = 0; i < obs.length; i++) {
        if (i !== drop) sub.push(i);
      }
      consider(sub);
    }
  }

  if (bestSet.length === 0) {
    return rejected(NO_SUBSET);
  }

  const cameras: string[] = [];
  for (const i of bestSet) cameras.push(obs[i].cameraId);

  const nScore = Math.min(1, 0.3 + 0.2 * bestSet.length);
  const resScore = clamp(
    1 - best.residual / Math.max(0.5, c.maxResidualM),
    0,
    1,
  );
  const parScore = clamp(best.parallax / 25, 0.2, 1);
  let qMean = 0;
  for (const i of bestSet) qMean += Math.max(0.05, obs[i].quality);
  qMean /= bestSet.length;
  const confidence = clamp(
    nScore * (0.4 * resScore + 0.3 * parScore + 0.3 * qMean) * 1.6,
    0,
    0.99,
  );

  return {
    ok: true,
    point: best.point,
    residualM: best.residual,
    parallaxDeg: best.parallax,
    confidence,
    cameras,
    rejectReason: '',
  };
}
