import type {
  CameraIntrinsics,
  CameraPose,
  Ray,
  Vec3,
} from '../geometry/fusion-geo';
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
} from '../geometry/fusion-geo';

export interface TriangulationConfig {
  minParallaxDeg: number; // 2 par défaut
  // Seuil d'erreur de reprojection par rayon, en pixels : il vaut la même
  // chose à toute distance, contrairement à un seuil en mètres. 120 px
  // accepte le banc non calibré (~110 px) et correspond à l'ancien seuil de
  // 3 m vers 30 m ; à resserrer vers 25 px une fois les poses calibrées.
  maxResidualPx: number; // 120 par défaut
  // Seuil facultatif sur la distance au rayon, en mètres ; 0 le désactive.
  maxResidualM: number; // 0 par défaut
  maxRangeM: number; // 60 par défaut
  /**
   * Distance minimale entre la solution et N'IMPORTE QUELLE caméra. Vérifier
   * que le point est devant l'objectif ne suffit pas : des directions mal
   * conditionnées peuvent se rejoindre à quelques centimètres d'une caméra
   * et passer tous les autres contrôles. Sur la carte, la cible apparaît
   * alors posée sur la caméra. Rien de ce que le système doit voir ne peut
   * être aussi près : on traite ce cas comme un croisement raté.
   */
  minRangeM: number; // 0,5 par défaut
  // Bruit sur le centre de la tache et bruit sur la pose (IMU, calibration),
  // utilisés pour calculer la covariance.
  pixelSigma: number; // 1,5 par défaut
  poseSigmaDeg: number; // 0,5 par défaut
}

export interface TriangulateObservation {
  cameraId: string;
  pixelX: number;
  pixelY: number;
  quality: number; // entre 0 et 1, sert de poids : max(0.05, quality)
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
  // Positions, dans le tableau d'entrée, des rayons gardés dans la solution.
  inliers: number[];
  // Covariance 3x3 de la position, en m², rangée ligne par ligne ; null si
  // le point est refusé.
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

/** Fabrique un résultat de refus avec son motif. */
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

/** Fabrique un résultat intermédiaire vide, marqué comme raté. */
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

/**
 * Bruit attendu en pixels pour une caméra : bruit sur le centre de la tache
 * plus bruit sur la pose, converti en pixels.
 */
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
  J: number[]; // 2x3, rangée ligne par ligne
}

/**
 * Mesure l'écart en pixels (observé moins calculé) pour un point, et
 * comment cet écart change quand on déplace le point d'un petit pas en x,
 * y et z (la jacobienne).
 */
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

/**
 * Ajoute la contribution d'une caméra au système de 3 équations que
 * Gauss-Newton résout à chaque itération.
 */
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

/**
 * Somme pondérée des erreurs de reprojection au carré pour un point.
 * C'est le score que refineReprojection cherche à faire baisser.
 */
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
 * Affine le point pour réduire l'erreur de reprojection en pixels (méthode
 * de Gauss-Newton, 3 inconnues). Le premier point compte les écarts en
 * mètres, donc une caméra lointaine pèse autant qu'une proche ; or le
 * capteur mesure des pixels. Ne renvoie jamais un point pire que p0.
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
 * Calcule la zone d'incertitude autour du point (covariance, en m²).
 * Elle est déduite du bruit attendu en pixels, puis agrandie quand les
 * rayons sont moins d'accord entre eux que ce bruit ne le prévoit.
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

// Vérifie que le point est devant chaque caméra, pas plus loin que la
// portée maximale et pas plus près que la portée minimale.
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

/**
 * Calcule un point pour un groupe de caméras : premier point, affinage,
 * contrôles de bon sens, puis mesure des écarts, de la parallaxe et de
 * l'incertitude. ok vaut false si le point est impossible.
 */
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
 * Croisements bruts de rayons, deux par deux, pour la vue de debug du rail.
 * Ils sont calculés volontairement avant les contrôles de parallaxe et de
 * résidu : ce sont des échantillons de géométrie, pas des cibles.
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

/**
 * Point d'entrée du module. Cherche le meilleur groupe de caméras, écarte
 * celle qui se trompe s'il y en a une, et renvoie le point avec une note de
 * confiance. Un refus renvoie ok: false avec un motif, sans exception.
 */
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

  // Évalue un groupe de caméras et le garde s'il bat le meilleur score.
  const consider = (idx: number[]): void => {
    if (idx.length < 2) return;
    const s = solveSubset(obs, idx, c);
    if (!s.ok) return;
    if (s.parallax < c.minParallaxDeg) return;
    // Chaque rayon doit être d'accord avec la solution, pas seulement en
    // moyenne : c'est ce qui écarte une tache fausse isolée.
    if (s.maxResidualPx > c.maxResidualPx) return;
    if (c.maxResidualM > 0 && s.maxResidual > c.maxResidualM) return;
    // On préfère plus de caméras, puis une erreur de reprojection plus
    // faible.
    const score = idx.length * 1000 - s.residualPx;
    if (score > bestScore) {
      bestScore = score;
      bestSet = idx;
      best = s;
    }
  };

  consider(all);

  // RANSAC simplifié : à partir de 3 caméras, on essaie aussi chaque groupe
  // privé d'une caméra, pour qu'une seule tache fausse ne tire pas le point.
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

  // Note de confiance : nombre de caméras, erreur en pixels, parallaxe et
  // qualité des détections. Les coefficients sont réglés à la main.
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
