import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CameraPosition } from '../../models/world-position.model';
import { CameraConfigService } from '../../services/camera-config.service';
import { NotificationService } from '../../services/notification.service';
import { RealtimeService } from '../../services/realtime.service';

@Component({
  selector: 'app-sidebar',
  imports: [ReactiveFormsModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly realtime = inject(RealtimeService);
  private readonly cameraConfig = inject(CameraConfigService);
  private readonly notifications = inject(NotificationService);
  readonly cameras = this.realtime.cameras;

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

  startEditing(camera: CameraPosition): void {
    this.positionForm.reset({ lat: camera.lat, lon: camera.lon, alt: camera.alt });
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
      this.saveError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }
}
