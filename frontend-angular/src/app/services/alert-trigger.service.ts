import { Injectable } from '@angular/core';
import { RealtimeService } from './realtime.service';
import { NotificationService } from './notification.service';

const HIGH_CONFIDENCE_THRESHOLD = 0.96;

@Injectable({ providedIn: 'root' })
export class AlertTriggerService {
  private readonly seenTrackIds = new Set<string>();
  private readonly droneAlertedIds = new Set<string>();

  constructor(
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
  ) {
    realtime.trackUpdates$.subscribe((track) => {
      // Nouvelle piste : alerte avec classification si disponible
      if (!this.seenTrackIds.has(track.trackId)) {
        this.seenTrackIds.add(track.trackId);
        const classifSuffix = track.classification ? ` (${track.classification.toUpperCase()})` : '';
        notifications.push('alert', `Nouvelle piste détectée : ${track.trackId}${classifSuffix}`);
      }

      // Alerte spécifique drone — une seule fois par piste
      if (track.classification === 'drone' && !this.droneAlertedIds.has(track.trackId)) {
        this.droneAlertedIds.add(track.trackId);
        notifications.push('alert', `DRONE confirmé — piste ${track.trackId}`);
      }
    });

    realtime.rawDetections$.subscribe((det) => {
      if (det.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        notifications.push(
          'warning',
          `Haute confiance ${(det.confidence * 100).toFixed(0)}% — ${det.cameraId}`,
        );
      }
    });
  }
}
