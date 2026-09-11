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
  lat?: number;
  lon?: number;
  alt?: number;
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

export interface FusionSnapshot {
  activeCameras: number;
  cameraCount: number;
  historyWindowMs: number;
  staleAfterMs: number;
  cameras: FusionCameraState[];
}
