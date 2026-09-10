import { CameraPosition } from '../models/world-position.model';
import { llaToLocalEnu } from '../utils/geo';

/**
 * Configuration physique d'une caméra. La liste est stockée par le backend
 * (`PUT /cameras/:id/position`) et reçue par l'événement WebSocket `camera_positions`.
 */
export interface CameraGpsConfig {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
  fovDeg: number;
}

// Portée non communiquée par le backend : valeur de repli si jamais une seule
// caméra est configurée (sinon la portée est la distance entre les deux premières).
export const FALLBACK_RANGE_M = 30;

export function buildCameraPositions(configs: CameraGpsConfig[]): CameraPosition[] {
  let rangeM = FALLBACK_RANGE_M;
  if (configs.length >= 2) {
    const [a, b] = configs;
    const { x, y } = llaToLocalEnu(b.lat, b.lon, b.alt, { lat: a.lat, lng: a.lon, alt: a.alt });
    rangeM = Math.hypot(x, y);
  }

  return configs.map((cam) => ({
    id: cam.id,
    lat: cam.lat,
    lon: cam.lon,
    alt: cam.alt,
    azimuthDeg: cam.headingDeg,
    fovDeg: cam.fovDeg,
    rangeM,
  }));
}
