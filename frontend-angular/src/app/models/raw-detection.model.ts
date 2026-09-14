export interface RawDetection {
  type: string;
  cameraId: string;
  frameIndex: number;
  timestamp: number;
  x: number;
  y: number;
  size: number;
  confidence: number;
  headingDeg?: number;
  elevationDeg?: number;
  rollDeg?: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  fovDeg?: number;
  k1?: number;
  k2?: number;
  p1?: number;
  p2?: number;
  k3?: number;
}
