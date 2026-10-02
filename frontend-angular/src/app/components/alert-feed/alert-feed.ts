import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { RealtimeService } from '../../services/realtime.service';
import { PersistedAlert } from '../../models/alert.model';

const MAX_ITEMS = 20;

@Component({
  selector: 'app-alert-feed',
  imports: [DatePipe],
  templateUrl: './alert-feed.html',
  styleUrl: './alert-feed.css',
})
export class AlertFeed implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly subscriptions: Subscription[] = [];

  readonly items = signal<PersistedAlert[]>([]);

  constructor() {
    void this.loadHistory();

    // Ingestion des nouvelles alertes émises par WS
    this.subscriptions.push(
      this.realtime.alerts$.subscribe((alert) => {
        this.items.update((current) => {
          const exists = current.some((a) => a.id === alert.id);
          if (exists) {
            return current.map((a) => (a.id === alert.id ? alert : a));
          }
          return [alert, ...current].slice(0, MAX_ITEMS);
        });
      }),
    );

    // Ingestion des alertes mises à jour (Synchro WS Acquittement / Résolution)
    this.subscriptions.push(
      this.realtime.alertUpdated$.subscribe((updatedAlert) => {
        this.items.update((current) =>
          current.map((item) =>
            item.id === updatedAlert.id ? { ...item, ...updatedAlert } : item,
          ),
        );
      }),
    );
  }

  acknowledge(alert: PersistedAlert): void {
    if (alert.status === 'RESOLVED') return;
    this.realtime.acknowledgeAlert(alert.id);
  }

  private async loadHistory(): Promise<void> {
    const token = this.auth.getToken();
    if (!token) return;
    try {
      const url = `${environment.apiUrl}/alerts?limit=${MAX_ITEMS}`;
      const headers = { Authorization: `Bearer ${token}` };
      const history = await firstValueFrom(
        this.http.get<PersistedAlert[]>(url, { headers }),
      );
      this.items.set(history);
    } catch {
      // Le flux temps réel (WS) reste utilisable même si l'historique échoue.
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }
}
