import {
  gpsToEnu,
  makeIntrinsics,
  type CameraIntrinsics,
  type CameraPose,
  type GeoOrigin,
  type Vec3,
} from '../geometry/fusion-geo';
import type { TriangulateObservation } from '../triangulation/fusion-triangulate';
import type { FusionObservation } from '../fusion.types';

/** Vrai si la valeur est un nombre utilisable (ni NaN ni infini). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Heure de capture la plus récente d'une file d'observations. */
export function latestTimestampUs(deque: FusionObservation[]): number {
  let latest = deque[0].timestampUs;
  for (const obs of deque) {
    if (obs.timestampUs > latest) {
      latest = obs.timestampUs;
    }
  }
  return latest;
}

/**
 * Position de la caméra en mètres dans le repère local : coordonnées
 * mesurées à la main si elles existent, sinon conversion du GPS.
 */
export function enuOf(
  obs: FusionObservation,
  origin: GeoOrigin | null,
): Vec3 | null {
  if (
    isFiniteNumber(obs.camX) &&
    isFiniteNumber(obs.camY) &&
    isFiniteNumber(obs.camZ)
  ) {
    return { x: obs.camX, y: obs.camY, z: obs.camZ };
  }
  if (
    !origin ||
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
    origin.lat,
    origin.lon,
    origin.alt,
  );
}

/**
 * Prépare une observation pour la triangulation : construit la pose et les
 * réglages d'optique de la caméra. Renvoie null sans cap ou sans position.
 */
export function toTriObs(
  obs: FusionObservation,
  origin: GeoOrigin | null,
): TriangulateObservation | null {
  // Pas de cap = pas de pose : un rayon supposé plein Nord est pire que
  // pas de rayon du tout.
  if (!isFiniteNumber(obs.headingDeg)) {
    return null;
  }
  const enu = enuOf(obs, origin);
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

/**
 * Renvoie la file d'une caméra sans ses observations trop vieilles, et
 * limitée à maxPerCamera éléments (les plus récents).
 */
export function pruneHistory(
  deque: FusionObservation[],
  nowMs: number,
  historyWindowMs: number,
  maxPerCamera: number,
): FusionObservation[] {
  // Relatif au plus récent de CETTE caméra (unix-us ou compteur boot).
  const keepUs = historyWindowMs * 1000;
  // On conserve les observations dont le timestamp est suffisamment récent :
  // on calcule la borne minimale minUs en soustrayant la fenêtre keepUs du timestamp le plus récent.
  const minUs = latestTimestampUs(deque) - keepUs;
  const minRecv = nowMs - historyWindowMs;
  const kept: FusionObservation[] = [];
  for (const item of deque) {
    if (item.timestampUs >= minUs && item.receivedAtMs >= minRecv) {
      kept.push(item);
    }
  }
  if (kept.length > maxPerCamera) {
    kept.splice(0, kept.length - maxPerCamera);
  }
  return kept;
}
