import { enuToGps, type GeoOrigin } from '../geometry/fusion-geo';
import type { TriangulationResult } from '../triangulation/fusion-triangulate';
import type {
  FusionCameraState,
  FusionLastFuse,
  FusionTrack,
  FusionTrackUpdate,
} from '../fusion.types';

export const NO_SUBSET = 'no subset passed parallax/residual gates';

/** Dernière observation retenue pour une caméra. */
export interface CameraLastSeen {
  timestampUs: number;
  receivedAtMs: number;
  x: number;
  y: number;
  confidence: number;
  hasPose: boolean;
}

/**
 * Convertit les pistes (mètres, repère local) en messages track_update
 * avec des coordonnées GPS, pour l'interface.
 */
export function toWsUpdates(
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

/** Résultat affiché quand moins de deux caméras voient quelque chose. */
export function needTwoFuse(): FusionLastFuse {
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

/** Met un résultat de triangulation au format affiché par l'interface. */
export function toLastFuse(result: TriangulationResult): FusionLastFuse {
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

/** Compare deux résultats : le plus de caméras gagne, puis la confiance. */
export function betterFuse(
  a: TriangulationResult,
  b: TriangulationResult,
): boolean {
  if (a.cameras.length !== b.cameras.length) {
    return a.cameras.length > b.cameras.length;
  }
  return a.confidence > b.confidence;
}

/**
 * Résume l'état d'une caméra : âge, activité, dernière détection. Renvoie
 * null pour une caméra inactive qui n'a plus aucune détection en file.
 */
export function cameraState(
  cameraId: string,
  seen: CameraLastSeen,
  detectionCount: number,
  nowMs: number,
  staleAfterMs: number,
): FusionCameraState | null {
  const ageMs = nowMs - seen.receivedAtMs;
  const active = ageMs <= staleAfterMs;
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
