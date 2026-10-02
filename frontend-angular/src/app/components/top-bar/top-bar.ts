import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { RealtimeService } from '../../services/realtime.service';
import { imuQuality } from '../../utils/imu-quality';

const CAM_NAMES: Record<string, string> = {
  jean: 'CAM 1',
  tanel: 'CAM 2',
  walid: 'CAM 3',
};

@Component({
  selector: 'app-top-bar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.css',
})
export class TopBar implements OnDestroy {
  readonly realtime = inject(RealtimeService);
  readonly uptime = signal(0);
  private readonly now = signal(Date.now());

  private readonly imuQualities = computed(() => {
    const now = this.now();
    return Object.values(this.realtime.imuByCamera()).map((sample) =>
      imuQuality(sample, now),
    );
  });

  readonly imuLiveCount = computed(
    () => this.imuQualities().filter((quality) => quality !== 'silencieuse').length,
  );
  readonly imuTrustedCount = computed(
    () => this.imuQualities().filter((quality) => quality === 'ok').length,
  );
  readonly previewLiveCount = computed(() => {
    const now = this.now();
    return Object.values(this.realtime.previewByCamera()).filter(
      (preview) => now - preview.receivedAt < 2000,
    ).length;
  });

  readonly systemHealth = computed(() => this.realtime.systemHealth());

  readonly cameraSummaries = computed(() => {
    const healths = this.realtime.cameraHealthByCamera();
    const stats = this.realtime.statsByCamera();
    const cameraIds = ['jean', 'tanel', 'walid'];

    return cameraIds.map((id) => {
      const h = healths[id];
      const s = stats[id];
      const name = CAM_NAMES[id] || id.toUpperCase();
      const state = h ? h.state : 'OK';
      const isV1 = s && s.version === 'v1';
      const diagnosticText = isV1 ? 'DIAGNOSTIC_LIMITÉ' : state;

      return {
        id,
        name,
        state,
        diagnosticText,
        isV1,
      };
    });
  });

  private uptimeTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.uptimeTimer = setInterval(() => {
      this.now.set(Date.now());
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
