import {
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CameraPosition } from '../../models/world-position.model';
import { ImuSample } from '../../models/imu-sample.model';
import { CameraPreview } from '../../models/camera-preview.model';
import { CameraConfigService } from '../../services/camera-config.service';
import { NotificationService } from '../../services/notification.service';
import { RealtimeService } from '../../services/realtime.service';
import {
  IMU_QUALITY_LABELS,
  ImuQuality,
  formatCalibration,
  imuQuality,
} from '../../utils/imu-quality';

@Component({
  selector: 'app-sidebar',
  imports: [ReactiveFormsModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar implements OnDestroy {
  readonly realtime = inject(RealtimeService);
  private readonly cameraConfig = inject(CameraConfigService);
  private readonly notifications = inject(NotificationService);
  readonly cameras = this.realtime.cameras;
  readonly now = signal(Date.now());

  readonly extraImuIds = computed(() => {
    const known = new Set(this.cameras().map((camera) => camera.id));
    return Object.keys(this.realtime.imuByCamera()).filter(
      (id) => !known.has(id),
    );
  });

  readonly extraPreviewIds = computed(() => {
    const known = new Set([
      ...this.cameras().map((camera) => camera.id),
      ...this.extraImuIds(),
    ]);
    return Object.keys(this.realtime.previewByCamera()).filter(
      (id) => !known.has(id),
    );
  });

  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly positionForm = new FormGroup({
    lat: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(-90),
      Validators.max(90),
    ]),
    lon: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(-180),
      Validators.max(180),
    ]),
    alt: new FormControl<number | null>(null, Validators.required),
  });

  private tick: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.tick = setInterval(() => this.now.set(Date.now()), 250);
  }

  imuOf(id: string): ImuSample | undefined {
    this.now();
    return this.realtime.imuOf(id);
  }

  previewOf(id: string): CameraPreview | undefined {
    this.now();
    return this.realtime.previewOf(id);
  }

  previewAge(id: string): string {
    const preview = this.previewOf(id);
    if (!preview) return 'hors ligne';
    const ageMs = Math.max(0, this.now() - preview.receivedAt);
    if (ageMs < 800) return 'live';
    return `${(ageMs / 1000).toFixed(1)} s`;
  }

  imuAge(id: string): string {
    const sample = this.imuOf(id);
    if (!sample) return 'aucune donnée';
    const ageMs = Math.max(0, this.now() - sample.receivedAt);
    if (ageMs < 800) return 'live';
    return `${(ageMs / 1000).toFixed(1)} s`;
  }

  qualityOf(sample: ImuSample): ImuQuality {
    return imuQuality(sample, this.now());
  }

  qualityLabel(sample: ImuSample): string {
    return IMU_QUALITY_LABELS[this.qualityOf(sample)];
  }

  calibText(sample: ImuSample): string {
    return formatCalibration(sample.calibration);
  }

  fmtDeg(value: number): string {
    return `${value.toFixed(1)}°`;
  }

  startEditing(camera: CameraPosition): void {
    this.positionForm.reset({
      lat: camera.lat,
      lon: camera.lon,
      alt: camera.alt,
    });
    this.saveError.set(null);
    this.editingId.set(camera.id);
  }

  cancelEditing(): void {
    this.editingId.set(null);
  }

  async savePosition(cameraId: string): Promise<void> {
    const { lat, lon, alt } = this.positionForm.getRawValue();
    if (this.positionForm.invalid || lat === null || lon === null || alt === null) {
      this.positionForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.cameraConfig.updatePosition(cameraId, { lat, lon, alt });
      this.editingId.set(null);
      this.notifications.push('info', `Position de ${cameraId} enregistrée`);
    } catch (error) {
      this.saveError.set(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.saving.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
  }
}
