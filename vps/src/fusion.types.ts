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

export interface FusionLastFuse {
  ok: boolean;
  rejectReason: string | null;
  residualM: number | null;
  // RMS reprojection error of the inlier rays, in pixels.
  residualPx?: number | null;
  parallaxDeg: number | null;
  confidence: number | null;
  cameras: string[];
  point: { x: number; y: number; z: number } | null;
}

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

/** Raw closest-point sample for one camera pair; never a tracked object. */
export interface FusionRayIntersection {
  point: { x: number; y: number; z: number };
  residualM: number;
  parallaxDeg: number;
  cameras: [string, string];
  timestampUs: number;
}

/** WebSocket `track_update` payload (same shape as the UDP objN frame). */
export interface FusionTrackUpdate {
  type: 'track_update';
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  timestamp: number;
  classification?: string;
}

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

/** WebSocket `fuse_update`: 3D point in metres (rail frame during bench). */
export interface FuseUpdate {
  type: 'fuse_update';
  lastFuse: FusionLastFuse | null;
  rawIntersections: FusionRayIntersection[];
  tracks: FusionTrack[];
}
