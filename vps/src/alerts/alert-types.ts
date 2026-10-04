export type AlertType = 'INFO' | 'WARNING' | 'CRITICAL';
export const AlertType = {
  INFO: 'INFO' as AlertType,
  WARNING: 'WARNING' as AlertType,
  CRITICAL: 'CRITICAL' as AlertType,
};

export type AlertCategory =
  | 'CAMERA_STATUS'
  | 'CAMERA_RECOVERED'
  | 'SYSTEM_BLIND'
  | 'OBJECT_DETECTED'
  | 'TO_VERIFY'
  | 'DRONE_CONFIRMED';
export const AlertCategory = {
  CAMERA_STATUS: 'CAMERA_STATUS' as AlertCategory,
  CAMERA_RECOVERED: 'CAMERA_RECOVERED' as AlertCategory,
  SYSTEM_BLIND: 'SYSTEM_BLIND' as AlertCategory,
  OBJECT_DETECTED: 'OBJECT_DETECTED' as AlertCategory,
  TO_VERIFY: 'TO_VERIFY' as AlertCategory,
  DRONE_CONFIRMED: 'DRONE_CONFIRMED' as AlertCategory,
};

export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';
export const AlertStatus = {
  NEW: 'NEW' as AlertStatus,
  ACKNOWLEDGED: 'ACKNOWLEDGED' as AlertStatus,
  RESOLVED: 'RESOLVED' as AlertStatus,
};

export type CameraState =
  | 'EN_ATTENTE'
  | 'OK'
  | 'DEGRADED_FROZEN'
  | 'DEGRADED_BLIND'
  | 'REDUCED_VISIBILITY_NIGHT'
  | 'HORS_SERVICE'
  | 'RECOVERING';
export const CameraState = {
  EN_ATTENTE: 'EN_ATTENTE' as CameraState,
  OK: 'OK' as CameraState,
  DEGRADED_FROZEN: 'DEGRADED_FROZEN' as CameraState,
  DEGRADED_BLIND: 'DEGRADED_BLIND' as CameraState,
  REDUCED_VISIBILITY_NIGHT: 'REDUCED_VISIBILITY_NIGHT' as CameraState,
  HORS_SERVICE: 'HORS_SERVICE' as CameraState,
  RECOVERING: 'RECOVERING' as CameraState,
};

export interface Alert {
  id: string;
  type: AlertType;
  category: AlertCategory;
  status: AlertStatus;
  message: string;
  trackId?: string | null;
  cameraIds: string[];
  cameraState?: CameraState | null;
  confidence?: number | null;
  acknowledgedAt?: Date | string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CameraStateLog {
  id: string;
  cameraId: string;
  state: CameraState;
  previousState?: CameraState | null;
  reason: string;
  lumMean?: number | null;
  lumStddev?: number | null;
  exposureUs?: number | null;
  gainDb?: number | null;
  createdAt: Date | string;
}
