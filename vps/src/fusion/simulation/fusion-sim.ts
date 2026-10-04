// Scènes fabriquées à plusieurs Pi pour tester le moteur de fusion. Des
// trajectoires connues sont projetées dans chaque caméra, puis abîmées
// comme sur le vrai matériel : bruit sur le centre des taches, erreur de
// cap de l'IMU, décalage d'horloge, images non synchronisées, délais
// réseau, fausses taches, détections ratées. Elles sont envoyées à
// FusionService dans l'ordre d'arrivée. Les mesures comparent les pistes
// obtenues à la vérité.
import {
  lookAt,
  makeIntrinsics,
  projectWorldToPixel,
  type Vec3,
} from '../geometry/fusion-geo';
import { FusionService } from '../fusion.service';
import type { FusionObservation } from '../fusion.types';

/** Une caméra simulée : où elle est posée et ce qu'elle regarde. */
export interface SimCamera {
  id: string;
  eye: Vec3;
  lookAt: Vec3;
  fovDeg?: number;
}

/** Description d'une scène à simuler. */
export interface SimScenario {
  cameras: SimCamera[];
  targets: Array<(tS: number) => Vec3>;
  durationS: number;
  fps: number;
  pixelNoise: number;
  // Écart-type d'une erreur de cap constante par caméra (IMU, calibration).
  headingBiasDeg: number;
  // Écart-type d'un décalage d'horloge constant par caméra.
  clockOffsetUs: number;
  // Plage du délai réseau par paquet (tirage uniforme).
  latencyMs: [number, number];
  // Nombre moyen de fausses taches par image et par caméra.
  falseBlobsPerFrame: number;
  // Probabilité qu'une caméra rate une cible visible sur une image.
  missRate: number;
  seed: number;
  // Modèle de masquage facultatif ; par défaut, visible partout dans l'image.
  visible?: (cameraId: string, target: number, tS: number) => boolean;
}

/** Mesures de qualité obtenues après une simulation. */
export interface SimMetrics {
  rmseM: number;
  p95M: number;
  matchedPoints: number;
  falsePoints: number;
  falseRatio: number;
  distinctIds: number;
  idSwitches: number;
  // Part des tranches de 100 ms, par cible, qui ont un point de piste.
  coverage: number;
}

const WIDTH = 1280;
const HEIGHT = 720;
const MATCH_M = 5;

/**
 * Générateur de nombres pseudo-aléatoires à graine : la même graine donne
 * toujours la même suite, donc les tests sont reproductibles.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire un nombre selon une loi normale (méthode de Box-Muller). */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Tire un nombre d'événements selon une loi de Poisson de moyenne mean. */
function poisson(rng: () => number, mean: number): number {
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > l);
  return k - 1;
}

interface Arrival {
  arrivalMs: number;
  obs: FusionObservation;
}

/**
 * Fabrique toutes les observations que le matériel enverrait, triées par
 * ordre d'arrivée au VPS.
 */
export function generateObservations(
  sc: SimScenario,
  baseUs: number,
): Arrival[] {
  const rng = mulberry32(sc.seed);
  const out: Arrival[] = [];
  const periodS = 1 / sc.fps;
  for (const cam of sc.cameras) {
    const truePose = lookAt(cam.eye, cam.lookAt);
    const intr = makeIntrinsics(WIDTH, HEIGHT, cam.fovDeg ?? 70);
    const reportedHeading =
      truePose.headingDeg + gaussian(rng) * sc.headingBiasDeg;
    const clockUs = gaussian(rng) * sc.clockOffsetUs;
    const phaseS = rng() * periodS;
    let frameIndex = 0;
    for (let tS = phaseS; tS < sc.durationS; tS += periodS, frameIndex++) {
      const blobs: { x: number; y: number; q: number }[] = [];
      sc.targets.forEach((target, ti) => {
        if (sc.visible && !sc.visible(cam.id, ti, tS)) return;
        if (rng() < sc.missRate) return;
        const pix = projectWorldToPixel(intr, truePose, target(tS));
        if (!pix) return;
        const x = pix[0] + gaussian(rng) * sc.pixelNoise;
        const y = pix[1] + gaussian(rng) * sc.pixelNoise;
        if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
        blobs.push({ x, y, q: 0.75 + 0.1 * rng() });
      });
      const falseCount = poisson(rng, sc.falseBlobsPerFrame);
      for (let k = 0; k < falseCount; k++) {
        blobs.push({
          x: rng() * WIDTH,
          y: rng() * HEIGHT,
          q: 0.3 + 0.3 * rng(),
        });
      }
      // Le Pi envoie sa tache la mieux notée en premier.
      blobs.sort((a, b) => b.q - a.q);
      const captureUs = baseUs + tS * 1e6;
      for (const b of blobs) {
        const latency =
          sc.latencyMs[0] + rng() * (sc.latencyMs[1] - sc.latencyMs[0]);
        const arrivalMs = captureUs / 1000 + latency;
        out.push({
          arrivalMs,
          obs: {
            cameraId: cam.id,
            frameIndex,
            timestampUs: Math.round(captureUs + clockUs),
            x: b.x,
            y: b.y,
            size: 20,
            confidence: b.q,
            receivedAtMs: arrivalMs,
            headingDeg: reportedHeading,
            elevationDeg: truePose.elevationDeg,
            rollDeg: 0,
            fx: intr.fx,
            fy: intr.fy,
            cx: intr.cx,
            cy: intr.cy,
            fovDeg: intr.fovDeg,
            imageWidth: WIDTH,
            imageHeight: HEIGHT,
            camX: cam.eye.x,
            camY: cam.eye.y,
            camZ: cam.eye.z,
          },
        });
      }
    }
  }
  out.sort((a, b) => a.arrivalMs - b.arrivalMs);
  return out;
}

export interface EngineLike {
  ingest(obs: FusionObservation, nowMs?: number): void;
  snapshot(nowMs?: number): {
    tracks: {
      objectId: number;
      timestampUs: number;
      x: number;
      y: number;
      z: number;
    }[];
  };
}

/**
 * Joue un scénario dans le moteur et compare les pistes obtenues aux
 * vraies trajectoires : erreur, faux points, changements d'identifiant,
 * part du temps couverte.
 */
export function runScenario(
  sc: SimScenario,
  makeEngine: () => EngineLike = () => new FusionService(),
): SimMetrics {
  // Vraie date de départ, pour qu'un moteur qui purge selon Date.now() se
  // comporte comme en production.
  const baseUs = Date.now() * 1000;
  const engine = makeEngine();
  const seen = new Set<string>();
  const errors: number[] = [];
  let falsePoints = 0;
  const idsByTarget: number[][] = sc.targets.map(() => []);
  const binsByTarget: Set<number>[] = sc.targets.map(() => new Set());
  const allIds = new Set<number>();

  for (const { arrivalMs, obs } of generateObservations(sc, baseUs)) {
    engine.ingest(obs, arrivalMs);
    for (const t of engine.snapshot(arrivalMs).tracks) {
      const key = `${t.objectId}:${t.timestampUs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allIds.add(t.objectId);
      const tS = (t.timestampUs - baseUs) / 1e6;
      let best = -1;
      let bestD = MATCH_M;
      sc.targets.forEach((target, ti) => {
        const p = target(tS);
        const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
        if (d < bestD) {
          bestD = d;
          best = ti;
        }
      });
      if (best < 0) {
        falsePoints += 1;
        continue;
      }
      errors.push(bestD);
      const ids = idsByTarget[best];
      if (ids[ids.length - 1] !== t.objectId) ids.push(t.objectId);
      binsByTarget[best].add(Math.floor(tS * 10));
    }
  }

  const sorted = errors.slice().sort((a, b) => a - b);
  const rmse = Math.sqrt(
    errors.reduce((s, e) => s + e * e, 0) / Math.max(1, errors.length),
  );
  const totalBins = Math.floor(sc.durationS * 10) * sc.targets.length;
  let coveredBins = 0;
  for (const bins of binsByTarget) coveredBins += bins.size;
  let idSwitches = 0;
  for (const ids of idsByTarget) idSwitches += Math.max(0, ids.length - 1);
  const total = errors.length + falsePoints;
  return {
    rmseM: rmse,
    p95M: sorted.length ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0,
    matchedPoints: errors.length,
    falsePoints,
    falseRatio: total ? falsePoints / total : 0,
    distinctIds: allIds.size,
    idSwitches,
    coverage: totalBins ? coveredBins / totalBins : 0,
  };
}

// Disposition de terrain à trois Pi, utilisée dans les tests de fusion.
export const FIELD_CAMERAS: SimCamera[] = [
  { id: 'jean', eye: { x: -12, y: -2, z: 2 }, lookAt: { x: 0, y: 30, z: 12 } },
  { id: 'tanel', eye: { x: 11, y: 1, z: 2 }, lookAt: { x: 0, y: 30, z: 12 } },
  { id: 'walid', eye: { x: 0, y: -14, z: 3 }, lookAt: { x: 0, y: 30, z: 12 } },
];

export const BASE_SCENARIO: Omit<SimScenario, 'targets'> = {
  cameras: FIELD_CAMERAS,
  durationS: 8,
  fps: 30,
  pixelNoise: 1.5,
  headingBiasDeg: 0.3,
  clockOffsetUs: 2000,
  latencyMs: [2, 25],
  falseBlobsPerFrame: 0,
  missRate: 0.05,
  seed: 1,
};

/** Trajectoire en ligne droite, à vitesse constante. */
export function straightLine(from: Vec3, velocity: Vec3): (tS: number) => Vec3 {
  return (tS) => ({
    x: from.x + velocity.x * tS,
    y: from.y + velocity.y * tS,
    z: from.z + velocity.z * tS,
  });
}

/** Cercle horizontal : un drone qui tourne autour d'un point. */
export function orbit(
  centre: Vec3,
  radiusM: number,
  speedMps: number,
  phase = 0,
): (tS: number) => Vec3 {
  const w = speedMps / radiusM;
  return (tS) => ({
    x: centre.x + radiusM * Math.cos(phase + w * tS),
    y: centre.y + radiusM * Math.sin(phase + w * tS),
    z: centre.z,
  });
}
