import { CameraPosition } from '../models/world-position.model';

/**
 * Configuration physique d'une caméra. La liste est stockée par le backend
 * (`PUT /cameras/:id/position`) et reçue par l'événement WebSocket `camera_positions`.
 * La portée (rangeM) est fournie par le backend, avec une valeur par défaut
 * réaliste — voir vps/src/cameras.service.ts.
 */
export interface CameraGpsConfig {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
  fovDeg: number;
  rangeM: number;
}

export function buildCameraPositions(configs: CameraGpsConfig[]): CameraPosition[] {
  return configs.map((cam) => ({
    id: cam.id,
    lat: cam.lat,
    lon: cam.lon,
    alt: cam.alt,
    azimuthDeg: cam.headingDeg,
    fovDeg: cam.fovDeg,
    rangeM: cam.rangeM,
  }));
}
