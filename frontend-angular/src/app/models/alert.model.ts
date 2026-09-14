export type AlertType = 'info' | 'warning' | 'alert';

/** Notable event pushed by the backend (new track or confirmed drone). */
export interface AlertEvent {
  type: AlertType;
  message: string;
  trackId?: string;
  cameraId?: string;
}

/** Persisted alert row, as returned by GET /alerts. */
export interface PersistedAlert extends AlertEvent {
  id: string;
  createdAt: string;
}
