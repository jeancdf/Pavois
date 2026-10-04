import {
  projectWorldToPixel,
  reprojectionErrorPx,
  vNorm,
  vSub,
  type Vec3,
} from '../geometry/fusion-geo';
import type { PredictedTrack, Tracker } from '../tracking/fusion-tracker';
import {
  triangulate,
  type TriangulateObservation,
  type TriangulationConfig,
  type TriangulationResult,
} from '../triangulation/fusion-triangulate';

/** Une tache d'une caméra à l'instant du tick, prête à être triangulée. */
export interface Candidate {
  cameraId: string;
  confidence: number;
  tri: TriangulateObservation;
  used: boolean;
}

/** Ce dont l'association a besoin : le suivi de pistes et les réglages. */
export interface AssociationContext {
  tracker: Tracker;
  triCfg: TriangulationConfig;
  assocGatePx: number;
  maxTargets: number;
}

interface Proposal {
  members: Candidate[];
  result: TriangulationResult;
}

/**
 * Incertitude d'une piste prédite, convertie en pixels dans l'image d'une
 * caméra. Sert à régler le seuil d'association.
 */
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
 * Association guidée par les pistes : chaque piste prédite est projetée
 * dans chaque caméra et prend la tache libre la plus proche. Une tache par
 * piste et par caméra.
 */
export function associateTracks(
  ctx: AssociationContext,
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
          ctx.assocGatePx,
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
        ctx.triCfg,
      );
      if (
        r.ok &&
        r.point &&
        ctx.tracker.updateTrack(
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
    // Une cible confirmée vue par une seule caméra explique quand même
    // cette tache : on la retire de la création de nouvelles cibles, pour
    // éviter les fantômes.
    if (track.confirmed && mine.length === 1) mine[0].used = true;
  });
}

/**
 * Crée de nouvelles cibles avec les taches qu'aucune piste n'explique.
 * Chaque paire de taches de deux caméras différentes est triangulée, puis
 * complétée par la tache la mieux accordée des autres caméras. On prend
 * ensuite les meilleures d'abord : le plus de caméras, puis le plus petit
 * résidu.
 */
export function spawnFromLeftovers(
  ctx: AssociationContext,
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

  const proposals: Proposal[] = [];
  for (let a = 0; a < cams.length; a++) {
    for (let b = a + 1; b < cams.length; b++) {
      for (const ca of free.get(cams[a])!) {
        for (const cb of free.get(cams[b])!) {
          const proposal = propose(ctx.triCfg, [ca, cb], cams, free);
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
    if (spawned >= ctx.maxTargets) break;
    if (members.some((m) => m.used)) continue;
    for (const m of members) m.used = true;
    ctx.tracker.update(
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

/**
 * Propose une nouvelle cible à partir d'une paire de taches : triangule la
 * paire, cherche dans les autres caméras la tache qui s'accorde le mieux,
 * puis retriangule avec toutes. Renvoie null si la paire est un fantôme.
 */
function propose(
  triCfg: TriangulationConfig,
  pair: Candidate[],
  cams: string[],
  free: Map<string, Candidate[]>,
): Proposal | null {
  const r2 = triangulate(
    pair.map((c) => c.tri),
    triCfg,
  );
  if (!r2.ok || !r2.point) return null;
  const members = pair.slice();
  for (const cam of cams) {
    if (cam === pair[0].cameraId || cam === pair[1].cameraId) continue;
    let best: Candidate | null = null;
    let bestErr = triCfg.maxResidualPx;
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
    return contradicted(r2.point, pair, cams, free)
      ? null
      : { members, result: r2 };
  }
  const r = triangulate(
    members.map((c) => c.tri),
    triCfg,
  );
  if (!r.ok || !r.point) {
    return contradicted(r2.point, pair, cams, free)
      ? null
      : { members: pair, result: r2 };
  }
  return { members: r.inliers.map((i) => members[i]), result: r };
}

/**
 * Preuve contre un fantôme à deux caméras : une autre caméra, qui envoie
 * des taches à ce tick et dont l'image contient le point, n'en a aucune
 * qui s'accorde avec lui. Une caméra qui n'a rien envoyé ne prouve rien.
 */
function contradicted(
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
