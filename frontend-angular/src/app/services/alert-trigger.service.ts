import { Injectable } from '@angular/core';
import { RealtimeService } from './realtime.service';
import { NotificationService } from './notification.service';

/**
 * Les règles (nouvelle piste et drone confirmé) sont calculées
 * côté serveur (AlertsService) et persistées : un onglet fermé au moment de
 * l'événement ne perd plus l'alerte. Ce service ne fait plus que relayer
 * l'événement WS `alert` vers les toasts.
 */
@Injectable({ providedIn: 'root' })
export class AlertTriggerService {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
  ) {
    realtime.alerts$.subscribe((alert) => {
      const toastType: ToastType =
        alert.type === 'CRITICAL'
          ? 'alert'
          : alert.type === 'WARNING'
            ? 'warning'
            : 'info';
      notifications.push(toastType, alert.message);
    });
  }
}
