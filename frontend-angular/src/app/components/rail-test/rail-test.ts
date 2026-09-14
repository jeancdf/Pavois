import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RailVolume } from '../rail-volume/rail-volume';
import { NotificationService } from '../../services/notification.service';
import { RailBenchService } from '../../services/rail-bench.service';
import { RealtimeService } from '../../services/realtime.service';
import {
  DEFAULT_RANGE_M,
  MAX_RAIL_VOXELS,
  RAIL_CAMERA_IDS,
  railVoxelOf,
  type RailVoxel,
} from '../../config/rail-bench';

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
  readonly voxels = signal<RailVoxel[]>([]);
  readonly cameraIds = RAIL_CAMERA_IDS;
  readonly ranges = [2, 2.5, 3];

  readonly bench = this.realtime.railBench;
  readonly seeing = computed(
    () => this.realtime.fuseUpdate()?.lastFuse?.cameras ?? [],
  );
  readonly rayResidualM = computed(
    () => this.realtime.fuseUpdate()?.lastFuse?.residualM ?? null,
  );

  private tick: ReturnType<typeof setInterval> | null = null;
  private readonly voxelCells = new Map<string, RailVoxel>();
  private lastFuse: object | null = null;

  constructor() {
    this.tick = setInterval(() => this.now.set(Date.now()), 250);
    effect(() => {
      const bench = this.bench();
      const fuse = this.realtime.fuseUpdate()?.lastFuse ?? null;
      if (fuse === this.lastFuse) return;
      this.lastFuse = fuse;
      if (!bench || !fuse?.ok || !fuse.point) return;

      const voxel = railVoxelOf(fuse.point);
      if (!voxel) return;
      const previous = this.voxelCells.get(voxel.key);
      if (previous) voxel.hits = previous.hits + 1;
      this.voxelCells.set(voxel.key, voxel);
      if (this.voxelCells.size > MAX_RAIL_VOXELS) {
        const oldest = this.voxelCells.keys().next().value as
          | string
          | undefined;
        if (oldest !== undefined) this.voxelCells.delete(oldest);
      }
      untracked(() => this.voxels.set([...this.voxelCells.values()]));
    });
  }

  ngOnInit(): void {
    void this.railBenchApi.refresh().catch(() => undefined);
  }

  setRange(event: Event): void {
    this.rangeM.set(Number((event.target as HTMLSelectElement).value));
  }

  async start(): Promise<void> {
    this.busy.set(true);
    this.resetVoxels();
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

  private resetVoxels(): void {
    this.voxelCells.clear();
    this.voxels.set([]);
    this.lastFuse = this.realtime.fuseUpdate()?.lastFuse ?? null;
  }

  async stop(): Promise<void> {
    this.busy.set(true);
    try {
      await this.railBenchApi.stop();
    } catch (error) {
      this.notifications.push(
        'alert',
        error instanceof Error ? error.message : 'arrêt impossible',
      );
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
