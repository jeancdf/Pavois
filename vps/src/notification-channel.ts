export interface NotificationMessage {
  title: string;
  description: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  isEnabled(): boolean;
  send(message: NotificationMessage): Promise<boolean>;
}
