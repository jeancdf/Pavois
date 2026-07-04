/**
 * Configuration physique réelle des caméras, communiquée par l'équipe backend
 * (pas encore exposée via un événement WebSocket dédié, donc en dur ici).
 */
export interface CameraGpsConfig {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
  fovDeg: number;
}

// Altitude convertie de pieds en mètres (192.0 ft × 0.3048).
export const CAMERAS_GPS_CONFIG: CameraGpsConfig[] = [
  {
    id: 'cam0',
    lat: 48.82608,
    lon: 2.36590,
    alt: 58.524,
    headingDeg: 249.0,
    fovDeg: 69.0,
  },
  {
    id: 'cam1',
    lat: 48.8260968,
    lon: 2.3658928,
    alt: 58.524,
    headingDeg: 249.0,
    fovDeg: 69.0,
  },
];

// Portée non communiquée par le backend : valeur de repli si jamais une seule
// caméra est configurée (sinon la portée est calculée dynamiquement, voir
// realtime.service.ts).
export const FALLBACK_RANGE_M = 30;
