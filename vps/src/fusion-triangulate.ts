import type { CameraIntrinsics, CameraPose, Ray, Vec3 } from './fusion-geo';
import {
  invert3,
  leastSquaresIntersection,
  minPairwiseAngleDeg,
  pixelToRay,
  projectWorldToPixel,
  rayResidual,
  solve3,
  vAdd,
  vDot,
  vNorm,
  vScale,
  vSub,
} from './fusion-geo';

export interface TriangulationConfig {
  minParallaxDeg: number; // default 2
  // Per-ray reprojection gate in pixels: scale-free, unlike a metre gate.
  // 120 px keeps the uncalibrated rail bench (~110 px) and matches the old
  // 3 m gate around 30 m; tighten to ~25 px once poses are calibrated.
  maxResidualPx: number; // default 120
  // Optional extra gate on the perpendicular ray distance; 0 disables it.
  maxResidualM: number; // default 0
  maxRangeM: number; // default 60
  /**
   * Closest a solution may sit to ANY camera. Cheirality only proves the point
   * is in front of the lens; a poorly conditioned set of bearings can collapse
   * onto a point centimetres away and pass every other gate, which shows up on
   * the map as a target sitting on the camera. Nothing this system is built to
   * see can be that close, so treat it as a failed intersection.
   */
  minRangeM: number; // default 0.5
  // Centroid noise and pose (IMU / calibration) noise feeding the covariance.
  pixelSigma: number; // default 1.5
  poseSigmaDeg: number; // default 0.5
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
  residualPx: number;
  parallaxDeg: number;
  confidence: number;
  cameras: string[];
  // Indices (into the input array) of the rays kept in the solution.
  inliers: number[];
  // 3x3 row-major position covariance in m², null when rejected.
  covariance: number[] | null;
  rejectReason: string;
}

export interface PairIntersection {
  point: Vec3;
  residualM: number;
  parallaxDeg: number;
  cameras: [string, string];
}

export const DEFAULT_TRIANGULATION_CONFIG: TriangulationConfig = {
  minParallaxDeg: 2,
  maxResidualPx: 120,
  maxResidualM: 0,
  maxRangeM: 60,
  minRangeM: 0.5,
  pixelSigma: 1.5,
  poseSigmaDeg: 0.5,
};

const NEED_OBS = 'need >= 2 observations';
const NO_SUBSET = 'no subset passed parallax/residual gates';
const GN_ITERATIONS = 6;
const MAX_CHI2_SCALE = 100;

interface Solve {
  ok: boolean;
  point: Vec3 | null;
  residual: number;
  maxResidual: number;
  residualPx: number;
  maxResidualPx: number;
  parallax: number;
  covariance: number[] | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rejected(reason: string): TriangulationResult {
  return {
    ok: false,
    point: null,
    residualM: 0,
    residualPx: 0,
    parallaxDeg: 0,
    confidence: 0,
    cameras: [],
    inliers: [],
    covariance: null,
    rejectReason: reason,
  };
}

function failedSolve(): Solve {
  return {
    ok: false,
    point: null,
    residual: 0,
    maxResidual: 0,
    residualPx: 0,
    maxResidualPx: 0,
    parallax: 0,
    covariance: null,
  };
}

/** Effective per-camera pixel sigma: centroid noise plus pose noise. */
function pixelSigmaOf(
  o: TriangulateObservation,
  c: TriangulationConfig,
): number {
  const f = 0.5 * (o.intrinsics.fx + o.intrinsics.fy);
  const pose = f * c.poseSigmaDeg * (Math.PI / 180);
  return Math.max(0.1, Math.hypot(c.pixelSigma, pose));
}

interface Linearized {
  r: [number, number];
  J: number[]; // 2x3 row-major
}

/** Residual (observed - projected) and its Jacobian w.r.t. the point. */
function linearize(o: TriangulateObservation, p: Vec3): Linearized | null {
  const base = projectWorldToPixel(o.intrinsics, o.pose, p);
  if (!base) return null;
  const range = vNorm(vSub(p, { x: o.pose.x, y: o.pose.y, z: o.pose.z }));
  const h = Math.max(1e-4, range * 1e-6);
  const J = [0, 0, 0, 0, 0, 0];
  const axes: Vec3[] = [
    { x: h, y: 0, z: 0 },
    { x: 0, y: h, z: 0 },
    { x: 0, y: 0, z: h },
  ];
  for (let k = 0; k < 3; k++) {
    const plus = projectWorldToPixel(o.intrinsics, o.pose, vAdd(p, axes[k]));
    const minus = projectWorldToPixel(o.intrinsics, o.pose, vSub(p, axes[k]));
    if (!plus || !minus) return null;
    J[k] = (plus[0] - minus[0]) / (2 * h);
    J[3 + k] = (plus[1] - minus[1]) / (2 * h);
  }
  return { r: [o.pixelX - base[0], o.pixelY - base[1]], J };
}

function accumulate(
  A: number[],
  b: number[],
  lin: Linearized,
  w: number,
): void {
  const { J, r } = lin;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      A[i * 3 + j] += w * (J[i] * J[j] + J[3 + i] * J[3 + j]);
    }
    b[i] += w * (J[i] * r[0] + J[3 + i] * r[1]);
  }
}

function weightedCost(
  obs: TriangulateObservation[],
  idx: number[],
  weights: number[],
  p: Vec3,
): number {
  let cost = 0;
  for (let k = 0; k < idx.length; k++) {
    const o = obs[idx[k]];
    const proj = projectWorldToPixel(o.intrinsics, o.pose, p);
    if (!proj) return Number.POSITIVE_INFINITY;
    const dx = o.pixelX - proj[0];
    const dy = o.pixelY - proj[1];
    cost += weights[k] * (dx * dx + dy * dy);
  }
  return cost;
}

/**
 * Gauss-Newton on the (distorted) reprojection error, 3 unknowns. The ray
 * midpoint weighs every camera in metres, so a far camera counted as much as
 * a near one; pixels are what the sensor actually measures.
 */
function refineReprojection(
  obs: TriangulateObservation[],
  idx: number[],
  weights: number[],
  p0: Vec3,
): Vec3 {
  let p = p0;
  let cost = weightedCost(obs, idx, weights, p);
  for (let it = 0; it < GN_ITERATIONS; it++) {
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 0, 0];
    for (let k = 0; k < idx.length; k++) {
      const lin = linearize(obs[idx[k]], p);
      if (!lin) return p;
      accumulate(A, b, lin, weights[k]);
    }
    const delta = solve3(A, b);
    if (!delta) return p;
    let step = delta;
    let next = vAdd(p, step);
    let nextCost = weightedCost(obs, idx, weights, next);
    if (!(nextCost <= cost)) {
      step = vScale(delta, 0.5);
      next = vAdd(p, step);
      nextCost = weightedCost(obs, idx, weights, next);
      if (!(nextCost <= cost)) return p;
    }
    p = next;
    cost = nextCost;
    if (vNorm(step) < 1e-6) break;
  }
  return p;
}

/**
 * Linearised position covariance (m²): inverse Fisher information of the
 * pixel measurements, inflated by the reduced chi² when rays disagree more
 * than the noise model predicts.
 */
function positionCovariance(
  obs: TriangulateObservation[],
  idx: number[],
  sigmas: number[],
  p: Vec3,
): number[] | null {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  let chi2 = 0;
  for (let k = 0; k < idx.length; k++) {
    const lin = linearize(obs[idx[k]], p);
    if (!lin) return null;
    const w = 1 / (sigmas[k] * sigmas[k]);
    accumulate(A, b, lin, w);
    chi2 += w * (lin.r[0] * lin.r[0] + lin.r[1] * lin.r[1]);
  }
  const cov = invert3(A);
  if (!cov) return null;
  const dof = 2 * idx.length - 3;
  const scale = dof > 0 ? clamp(chi2 / dof, 1, MAX_CHI2_SCALE) : 1;
  return cov.map((v) => v * scale);
}

// Cheirality: the point must be in front of every camera, and neither
// beyond the range cap nor closer than the range floor.
function inFrontAndInRange(
  rays: Ray[],
  p: Vec3,
  c: TriangulationConfig,
): boolean {
  for (const r of rays) {
    const toP = vSub(p, r.origin);
    if (vDot(toP, r.direction) <= 0) return false;
    const range = vNorm(toP);
    if (c.maxRangeM > 0 && range > c.maxRangeM * 1.5) return false;
    if (c.minRangeM > 0 && range < c.minRangeM) return false;
  }
  return true;
}

function solveSubset(
  obs: TriangulateObservation[],
  idx: number[],
  c: TriangulationConfig,
): Solve {
  const s = failedSolve();
  const rays: Ray[] = [];
  const sigmas: number[] = [];
  const weights: number[] = [];
  for (const i of idx) {
    const o = obs[i];
    rays.push(pixelToRay(o.intrinsics, o.pose, o.pixelX, o.pixelY));
    const sigma = pixelSigmaOf(o, c);
    sigmas.push(sigma);
    weights.push(Math.max(0.05, o.quality) / (sigma * sigma));
  }
  const p0 = leastSquaresIntersection(
    rays,
    idx.map((i) => Math.max(0.05, obs[i].quality)),
  );
  if (!p0 || !inFrontAndInRange(rays, p0, c)) return s;

  const p = refineReprojection(obs, idx, weights, p0);
  if (!inFrontAndInRange(rays, p, c)) return s;

  let rsum = 0;
  let pxSq = 0;
  for (let k = 0; k < rays.length; k++) {
    const rr = rayResidual(rays[k], p);
    rsum += rr;
    s.maxResidual = Math.max(s.maxResidual, rr);
    const o = obs[idx[k]];
    const proj = projectWorldToPixel(o.intrinsics, o.pose, p);
    if (!proj) return failedSolve();
    const e = Math.hypot(o.pixelX - proj[0], o.pixelY - proj[1]);
    pxSq += e * e;
    s.maxResidualPx = Math.max(s.maxResidualPx, e);
  }
  s.residual = rsum / rays.length;
  s.residualPx = Math.sqrt(pxSq / rays.length);
  s.parallax = minPairwiseAngleDeg(rays);
  s.covariance = positionCovariance(obs, idx, sigmas, p);
  s.point = p;
  s.ok = true;
  return s;
}

/**
 * Unfiltered pairwise ray intersections for the rail debug view. These are
 * deliberately produced before parallax/residual target gates: they are
 * geometry samples, not tracks or confirmed objects.
 */
export function pairIntersections(
  obs: TriangulateObservation[],
  maxRangeM = DEFAULT_TRIANGULATION_CONFIG.maxRangeM,
  minRangeM = DEFAULT_TRIANGULATION_CONFIG.minRangeM,
): PairIntersection[] {
  const intersections: PairIntersection[] = [];
  for (let i = 0; i < obs.length; ++i) {
    for (let j = i + 1; j < obs.length; ++j) {
      if (obs[i].cameraId === obs[j].cameraId) continue;
      const first = pixelToRay(
        obs[i].intrinsics,
        obs[i].pose,
        obs[i].pixelX,
        obs[i].pixelY,
      );
      const second = pixelToRay(
        obs[j].intrinsics,
        obs[j].pose,
        obs[j].pixelX,
        obs[j].pixelY,
      );
      const betweenOrigins = vSub(first.origin, second.origin);
      const dot = vDot(first.direction, second.direction);
      const denominator = 1 - dot * dot;
      if (denominator <= 1e-12) continue;

      const firstDistance =
        (dot * vDot(second.direction, betweenOrigins) -
          vDot(first.direction, betweenOrigins)) /
        denominator;
      const secondDistance =
        (vDot(second.direction, betweenOrigins) -
          dot * vDot(first.direction, betweenOrigins)) /
        denominator;
      if (firstDistance <= 0 || secondDistance <= 0) continue;
      if (
        minRangeM > 0 &&
        (firstDistance < minRangeM || secondDistance < minRangeM)
      ) {
        continue;
      }
      if (
        maxRangeM > 0 &&
        (firstDistance > maxRangeM * 1.5 || secondDistance > maxRangeM * 1.5)
      ) {
        continue;
      }

      const firstPoint = vAdd(
        first.origin,
        vScale(first.direction, firstDistance),
      );
      const secondPoint = vAdd(
        second.origin,
        vScale(second.direction, secondDistance),
      );
      const point = vScale(vAdd(firstPoint, secondPoint), 0.5);
      intersections.push({
        point,
        residualM:
          (rayResidual(first, point) + rayResidual(second, point)) * 0.5,
        parallaxDeg: minPairwiseAngleDeg([first, second]),
        cameras: [obs[i].cameraId, obs[j].cameraId],
      });
    }
  }
  return intersections;
}

export function triangulate(
  obs: TriangulateObservation[],
  cfg?: Partial<TriangulationConfig>,
): TriangulationResult {
  const c: TriangulationConfig = { ...DEFAULT_TRIANGULATION_CONFIG, ...cfg };
  if (obs.length < 2) {
    return rejected(NEED_OBS);
  }

  const all: number[] = [];
  for (let i = 0; i < obs.length; i++) all.push(i);

  let bestSet: number[] = [];
  let best = failedSolve();
  let bestScore = -Infinity;

  const consider = (idx: number[]): void => {
    if (idx.length < 2) return;
    const s = solveSubset(obs, idx, c);
    if (!s.ok) return;
    if (s.parallax < c.minParallaxDeg) return;
    // Every contributing ray must agree with the solution, not just on
    // average -- this is what forces a lone bad blob out of the inlier set.
    if (s.maxResidualPx > c.maxResidualPx) return;
    if (c.maxResidualM > 0 && s.maxResidual > c.maxResidualM) return;
    // Prefer more inliers, then lower reprojection error.
    const score = idx.length * 1000 - s.residualPx;
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
    1 - best.residualPx / Math.max(1, c.maxResidualPx),
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
    residualPx: best.residualPx,
    parallaxDeg: best.parallax,
    confidence,
    cameras,
    inliers: bestSet.slice(),
    covariance: best.covariance,
    rejectReason: '',
  };
}
