/** Une détection envoyée par un Pi : une tache dans l'image d'une caméra. */
export interface FusionObservation {
  cameraId: string;
  frameIndex: number;
  timestampUs: number;
  x: number;
  y: number;
  size: number;
  confidence: number;
  receivedAtMs: number;
  headingDeg?: number;
  elevationDeg?: number;
  rollDeg?: number;
  fovDeg?: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  k1?: number;
  k2?: number;
  p1?: number;
  p2?: number;
  k3?: number;
  lat?: number;
  lon?: number;
  alt?: number;
  camX?: number;
  camY?: number;
  camZ?: number;
  imageWidth?: number;
  imageHeight?: number;
}

/** État d'une caméra vu par le moteur de fusion. */
export interface FusionCameraState {
  cameraId: string;
  detectionCount: number;
  lastTimestampUs: number | null;
  lastReceivedAtMs: number | null;
  ageMs: number | null;
  active: boolean;
  hasPose: boolean;
  lastX: number | null;
  lastY: number | null;
  lastConfidence: number | null;
}

/** Résultat de la dernière triangulation, affiché par l'interface. */
export interface FusionLastFuse {
  ok: boolean;
  rejectReason: string | null;
  residualM: number | null;
  // Erreur de reprojection des rayons gardés (moyenne quadratique), en
  // pixels.
  residualPx?: number | null;
  parallaxDeg: number | null;
  confidence: number | null;
  cameras: string[];
  point: { x: number; y: number; z: number } | null;
}

/** Une piste : une cible suivie dans le temps, en mètres. */
export interface FusionTrack {
  objectId: number;
  timestampUs: number;
  x: number;
  y: number;
  z: number;
  confidence: number;
  cameras: string[];
  classification: string;
}

/**
 * Croisement brut des rayons d'une paire de caméras. Jamais une cible
 * suivie.
 */
export interface FusionRayIntersection {
  point: { x: number; y: number; z: number };
  residualM: number;
  parallaxDeg: number;
  cameras: [string, string];
  timestampUs: number;
}

/** Message WebSocket `track_update` (même forme que la trame UDP objN). */
export interface FusionTrackUpdate {
  type: 'track_update';
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  timestamp: number;
  classification?: string;
}

/** État complet du moteur à un instant donné. */
export interface FusionSnapshot {
  activeCameras: number;
  cameraCount: number;
  historyWindowMs: number;
  staleAfterMs: number;
  cameras: FusionCameraState[];
  lastFuse: FusionLastFuse | null;
  rawIntersections: FusionRayIntersection[];
  tracks: FusionTrack[];
}

/**
 * Message WebSocket `fuse_update` : point 3D en mètres (repère du rail
 * pendant les essais sur banc).
 */
export interface FuseUpdate {
  type: 'fuse_update';
  lastFuse: FusionLastFuse | null;
  rawIntersections: FusionRayIntersection[];
  tracks: FusionTrack[];
}
