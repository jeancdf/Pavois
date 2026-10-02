export type AlertType = 'INFO' | 'WARNING' | 'CRITICAL';

export type AlertCategory =
  | 'CAMERA_STATUS'
  | 'CAMERA_RECOVERED'
  | 'SYSTEM_BLIND'
  | 'OBJECT_DETECTED'
  | 'TO_VERIFY'
  | 'DRONE_CONFIRMED';

export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

export type CameraState =
  | 'OK'
  | 'DEGRADED_FROZEN'
  | 'DEGRADED_BLIND'
  | 'REDUCED_VISIBILITY_NIGHT'
  | 'HORS_SERVICE'
  | 'RECOVERING';

/** Event or persisted alert row pushed by backend WebSocket / API. */
export interface PersistedAlert {
  id: string;
  type: AlertType;
  category: AlertCategory;
  status: AlertStatus;
  message: string;
  trackId?: string | null;
  cameraIds?: string[];
  cameraState?: CameraState | null;
  confidence?: number | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type AlertEvent = PersistedAlert;
