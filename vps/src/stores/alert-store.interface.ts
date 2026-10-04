import { Alert, AlertStatus, CameraStateLog } from '../alerts/alert-types';

export interface CreateAlertData {
  type: Alert['type'];
  category: Alert['category'];
  status?: AlertStatus;
  message: string;
  trackId?: string | null;
  cameraIds?: string[];
  cameraState?: Alert['cameraState'];
  confidence?: number | null;
}

export interface UpdateAlertData {
  type?: Alert['type'];
  category?: Alert['category'];
  status?: AlertStatus;
  message?: string;
  confidence?: number | null;
  cameraIds?: string[];
  acknowledgedAt?: Date | string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: Date | string | null;
}

export interface ListAlertsOptions {
  limit?: number;
  before?: string;
  status?: AlertStatus;
}

export const ALERT_STORE = Symbol('ALERT_STORE');
export const CAMERA_LOG_STORE = Symbol('CAMERA_LOG_STORE');

export interface AlertStore {
  create(data: CreateAlertData): Promise<Alert>;
  update(id: string, data: UpdateAlertData): Promise<Alert | null>;
  findUnique(id: string): Promise<Alert | null>;
  findMany(options?: ListAlertsOptions): Promise<Alert[]>;
  purgeOlderThan(days: number): Promise<number>;
}

export interface CameraStateLogStore {
  createStateLog(data: Omit<CameraStateLog, 'id' | 'createdAt'>): Promise<CameraStateLog>;
}
