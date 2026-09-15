import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RailVolume } from '../rail-volume/rail-volume';
import { NotificationService } from '../../services/notification.service';
import { RailBenchService } from '../../services/rail-bench.service';
import { RealtimeService } from '../../services/realtime.service';
import { DEFAULT_RANGE_M, RAIL_CAMERA_IDS, distanceM, type Vec3m } from '../../config/rail-bench';

@Component({
  selector: 'app-rail-test',
  imports: [RailVolume],
  templateUrl: './rail-test.html',
  styleUrl: './rail-test.css',
})
export class RailTestPage implements OnInit, OnDestroy {
  private readonly railBenchApi = inject(RailBenchService);
  private readonly notifications = inject(NotificationService);
  readonly realtime = inject(RealtimeService);
  readonly now = signal(Date.now());
  readonly rangeM = signal(DEFAULT_RANGE_M);
  readonly busy = signal(false);
  readonly cameraIds = RAIL_CAMERA_IDS;
  readonly ranges = [2, 2.5, 3];

  readonly bench = this.realtime.railBench;
  readonly estimated = computed<Vec3m | null>(() => {
    const classification = this.realtime.targetClassification();
    if (classification?.status === 'complete' && classification.label !== 'drone') {
      return null;
    }
    const update = this.realtime.fuseUpdate();
    const fuse = update?.lastFuse;
    if (fuse?.ok && fuse.point) return fuse.point;
    const track = update?.tracks[0];
    return track ? { x: track.x, y: track.y, z: track.z } : null;
  });
  readonly seeing = computed(() => this.realtime.fuseUpdate()?.lastFuse?.cameras ?? []);
  readonly classificationText = computed(() => {
    const classification = this.realtime.targetClassification();
    if (!classification) return 'en attente';
    if (classification.status === 'pending') {
      return `photos ${classification.receivedCameras.length}/3`;
    }
    if (classification.status === 'analyzing') return 'analyse OpenCV';
    if (classification.label === 'drone') {
      return `drone ${Math.round(classification.confidence * 100)}%`;
    }
    if (classification.label === 'human') return 'humain ignoré';
    return 'inconnu ignoré';
  });
  readonly errorM = computed(() => {
    const bench = this.bench();
    const estimated = this.estimated();
    if (!bench || !estimated) return null;
    return distanceM(bench.expected, estimated);
  });

  private tick: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.tick = setInterval(() => this.now.set(Date.now()), 250);
  }

  ngOnInit(): void {
    void this.railBenchApi.refresh().catch(() => undefined);
  }

  setRange(event: Event): void {
    this.rangeM.set(Number((event.target as HTMLSelectElement).value));
  }

  async start(): Promise<void> {
    this.busy.set(true);
    try {
      await this.railBenchApi.start({
        rangeM: this.rangeM(),
        targetSizeM: 0.2,
      });
      this.notifications.push('info', 'Test rail lancé, regard figé vers l’avant');
    } catch (error) {
      this.notifications.push(
        'alert',
        error instanceof Error ? error.message : 'échec du test rail',
      );
    } finally {
      this.busy.set(false);
    }
  }

  async stop(): Promise<void> {
    this.busy.set(true);
    try {
      await this.railBenchApi.stop();
    } catch (error) {
      this.notifications.push('alert', error instanceof Error ? error.message : 'arrêt impossible');
    } finally {
      this.busy.set(false);
    }
  }

  fpsOf(id: string): string {
    this.now();
    const stats = this.realtime.statsOf(id);
    if (!stats || this.now() - stats.receivedAt > 4000) return '—';
    return stats.fps.toFixed(1);
  }

  detectionAge(id: string): string {
    this.now();
    const at = this.realtime.lastDetectionAt()[id];
    if (!at) return 'aucune';
    const sec = Math.max(0, (this.now() - at) / 1000);
    return sec < 2 ? 'live' : `${sec.toFixed(1)} s`;
  }

  previewAge(id: string): string {
    this.now();
    const preview = this.realtime.previewOf(id);
    if (!preview) return 'hors ligne';
    const sec = Math.max(0, (this.now() - preview.receivedAt) / 1000);
    return sec < 2 ? 'live' : `${sec.toFixed(1)} s`;
  }

  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
  }
}
