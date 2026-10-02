export interface CameraStats {
  type: 'camera_stats';
  version?: string;
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  receivedAt: number;
}
