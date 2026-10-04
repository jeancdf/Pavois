export interface NotificationMessage {
  title: string;
  description: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  category?: string;
  timestamp: Date;
  alertId?: string;
  cameraIds?: string[];
  cause?: string;
  confidence?: number;
  lat?: number;
  lng?: number;
  reliability?: string;
  incidentDurationMs?: number;
  isSimulation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  isEnabled(): boolean;
  send(message: NotificationMessage): Promise<boolean>;
}
