export interface RawDetection {
  type: string;
  cameraId: string;
  frameIndex: number;
  timestamp: number;
  x: number;
  y: number;
  size: number;
  confidence: number;
}
