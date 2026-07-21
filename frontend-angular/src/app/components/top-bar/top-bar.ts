import { Component, OnDestroy, inject, signal } from '@angular/core';
import { RealtimeService } from '../../services/realtime.service';

@Component({
  selector: 'app-top-bar',
  imports: [],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.css',
})
export class TopBar implements OnDestroy {
  readonly realtime = inject(RealtimeService);
  readonly uptime = signal(0);

  private uptimeTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.uptimeTimer = setInterval(() => {
      const since = this.realtime.connectedSince();
      this.uptime.set(since ? Math.floor((Date.now() - since) / 1000) : 0);
    }, 1000);
  }

  formatUptime(seconds: number): string {
    if (seconds === 0) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
    return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
  }

  ngOnDestroy(): void {
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
  }
}
