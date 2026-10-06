/**
 * Une détection envoyée par un Pi : une tache dans l'image d'une caméra.
 * Les champs sans `?` viennent toujours du message. Les autres peuvent
 * manquer : la pose et l'optique sont alors complétées par la config.
 */
export interface FusionObservation {
  /** Identifiant de la caméra qui a vu la tache. */
  cameraId: string;
  /** Numéro de l'image sur ce Pi. */
  frameIndex: number;
  /** Heure de la prise de vue, en microsecondes, horloge du Pi. */
  timestampUs: number;
  /** Centre de la tache, en pixels. x vers la droite, y vers le bas. */
  x: number;
  y: number;
  /** Aire de la tache, en pixels. */
  size: number;
  /** Score de la détection : plus il est haut, plus la tache est sûre. */
  confidence: number;
  /** Heure d'arrivée du message sur le VPS, en millisecondes. */
  receivedAtMs: number;
  /** Cap de la caméra, en degrés. 0 = Nord, sens horaire. */
  headingDeg?: number;
  /** Inclinaison vers le haut, en degrés. 0 = horizontal. */
  elevationDeg?: number;
  /** Roulis de la caméra, en degrés. */
  rollDeg?: number;
  /** Champ de vision horizontal, en degrés. Sert si fx et fy manquent. */
  fovDeg?: number;
  /** Focale horizontale de l'objectif, en pixels. */
  fx?: number;
  /** Focale verticale de l'objectif, en pixels. */
  fy?: number;
  /** Centre optique horizontal, en pixels. */
  cx?: number;
  /** Centre optique vertical, en pixels. */
  cy?: number;
  /** Distorsion radiale : courbure des bords (barillet ou coussinet). */
  k1?: number;
  k2?: number;
  /** Distorsion tangentielle : objectif légèrement de travers. */
  p1?: number;
  p2?: number;
  /** Distorsion radiale d'ordre plus fort que k1 et k2. */
  k3?: number;
  /** Latitude GPS de la caméra, en degrés. Pas la position de la tache. */
  lat?: number;
  /** Longitude GPS de la caméra, en degrés. */
  lon?: number;
  /** Altitude GPS de la caméra, en mètres. */
  alt?: number;
  /**
   * Position mesurée de la caméra, en mètres, repère Est-Nord-Haut.
   * Prioritaire sur le GPS quand les trois sont présents.
   */
  camX?: number;
  camY?: number;
  camZ?: number;
  /** Largeur de l'image, en pixels. Présente avec fx, fy, cx et cy. */
  imageWidth?: number;
  /** Hauteur de l'image, en pixels. */
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
