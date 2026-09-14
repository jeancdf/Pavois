import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { RealtimeService } from '../../services/realtime.service';
import { PersistedAlert } from '../../models/alert.model';

const MAX_ITEMS = 15;

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
  private readonly subscription: Subscription;

  readonly items = signal<PersistedAlert[]>([]);

  constructor() {
    void this.loadHistory();
    // Alertes nouvellement diffusées, en tête de liste sans re-fetch.
    this.subscription = this.realtime.alerts$.subscribe((alert) => {
      this.items.update((current) => [
        { ...alert, id: `live-${Date.now()}`, createdAt: new Date().toISOString() },
        ...current,
      ].slice(0, MAX_ITEMS));
    });
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
    this.subscription.unsubscribe();
  }
}
