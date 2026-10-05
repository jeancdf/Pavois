import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RailOrder } from '../rail-order/rail-order';
import { RailVolume } from '../rail-volume/rail-volume';
import { TuningPanel } from '../tuning-panel/tuning-panel';
import { NotificationService } from '../../services/notification.service';
import { RailBenchService } from '../../services/rail-bench.service';
import { RealtimeService } from '../../services/realtime.service';
import { DEFAULT_RANGE_M, RAIL_CAMERA_IDS, distanceM, type Vec3m } from '../../config/rail-bench';
import type { FuseTrack } from '../../models/fuse-update.model';
import type {
  ClassificationReviewImage,
  ClassificationVote,
} from '../../models/target-classification.model';

@Component({
  selector: 'app-rail-test',
  imports: [RailOrder, RailVolume, TuningPanel, DecimalPipe],
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
  // Panneau de réglages à chaud, à côté de la scène pour voir l'effet en direct.
  readonly showTuning = signal(false);
  readonly cameraIds = RAIL_CAMERA_IDS;
  readonly ranges = [2, 2.5, 3];

  readonly bench = this.realtime.railBench;
  // A completed classification that is not a drone hides the target.
  private readonly rejected = computed(() => {
    const classification = this.realtime.targetClassification();
    return classification?.status === 'complete' && classification.label !== 'drone';
  });
  readonly estimated = computed<Vec3m | null>(() => {
    if (this.rejected()) return null;
    const update = this.realtime.fuseUpdate();
    const fuse = update?.lastFuse;
    if (fuse?.ok && fuse.point) return fuse.point;
    const track = update?.tracks[0];
    return track ? { x: track.x, y: track.y, z: track.z } : null;
  });
  // Every track the fusion engine follows; the volume draws them one by one.
  readonly tracks = computed<FuseTrack[]>(() =>
    this.rejected() ? [] : (this.realtime.fuseUpdate()?.tracks ?? []),
  );
  readonly review = this.realtime.classificationReview;
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

  imageSrc(image: ClassificationReviewImage): string {
    return `data:${image.mime};base64,${image.jpegBase64}`;
  }

  voteLabel(vote: ClassificationVote | null): string {
    if (!vote) return 'pas de verdict';
    const label = vote.label === 'human' ? 'humain' : vote.label === 'drone' ? 'drone' : 'inconnu';
    return `${label} ${Math.round(vote.confidence * 100)}%`;
  }

  reasonLabel(reason: string | undefined): string {
    switch (reason) {
      case 'hog_person':
        return 'silhouette humaine';
      case 'face':
        return 'visage détecté';
      case 'non_human_sharp_motion':
        return 'objet mobile net';
      case 'motion_roi_blurry':
        return 'objet trop flou';
      case 'motion_roi_missing':
        return 'aucune zone exploitable';
      default:
        return 'analyse indisponible';
    }
  }

  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
  }
}
