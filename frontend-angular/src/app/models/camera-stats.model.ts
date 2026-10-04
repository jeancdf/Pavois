export interface CameraStats {
  type: 'camera_stats';
  version?: string;
  cameraId: string;
  fps: number;
  frameIndex: number;
  timestamp: number;
  // Pose et gain que la caméra a réellement utilisés ; 0 quand le Pi ne les connaît pas.
  exposureUs?: number;
  gainDb?: number;
  receivedAt: number;
}
