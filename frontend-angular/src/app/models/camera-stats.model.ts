export interface CameraStats {
  type: 'camera_stats';
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  receivedAt: number;
}
