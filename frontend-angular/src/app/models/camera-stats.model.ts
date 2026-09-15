export interface CameraStats {
  type: 'camera_stats';
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  captureFps?: number;
  droppedFrames?: number;
  detectorMs?: number;
  temperatureC?: number;
  receivedAt: number;
}
