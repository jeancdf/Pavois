import { CameraState } from './alert.model';

export type GlobalReliability = 'GREEN' | 'ORANGE' | 'RED';

export interface CameraHealthStatus {
  cameraId: string;
  displayName: string;
  state: CameraState;
  previousState: CameraState | null;
  reason: string;
  lastSeenMs: number;
  lastFrameIndex: number;
  lumMean: number;
  lumStddev: number;
  exposureUs: number;
  gainDb: number;
}

export interface SystemHealthUpdate {
  reliability: GlobalReliability;
  activeCameraCount: number;
  message: string;
}

export interface CameraStatusUpdatePayload {
  status: CameraHealthStatus;
  globalUpdate: SystemHealthUpdate;
}
