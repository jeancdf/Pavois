import { Injectable, OnDestroy, computed, effect, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { RawDetection } from '../models/raw-detection.model';
import { TrackUpdate } from '../models/track-update.model';
import { CameraGpsConfig, buildCameraPositions } from '../config/cameras.config';
import { AuthService } from './auth.service';
import { ImuSample } from '../models/imu-sample.model';
import { CameraPreview } from '../models/camera-preview.model';
import { AlertEvent } from '../models/alert.model';

const RECONNECT_DELAY_MS = 2000;

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  readonly connected = signal(false);
  readonly connectedSince = signal<number | null>(null);
  // Positions stockées par le backend : envoyées à la connexion puis à chaque modification
  readonly cameraConfigs = signal<CameraGpsConfig[]>([]);
  readonly cameras = computed(() => buildCameraPositions(this.cameraConfigs()));
  readonly imuByCamera = signal<Record<string, ImuSample>>({});
  readonly previewByCamera = signal<Record<string, CameraPreview>>({});
  readonly rawDetections$ = new Subject<RawDetection>();
  readonly trackUpdates$ = new Subject<TrackUpdate>();
  readonly alerts$ = new Subject<AlertEvent>();

  // Compteurs KPI — mis à jour en temps réel dans le handler de messages
  readonly totalDetections = signal(0);
  readonly activeTrackCount = signal(0);
  private readonly seenTrackIds = new Set<string>();

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly authService: AuthService) {
    // Déclenche la connexion dès que l'utilisateur est authentifié
    effect(() => {
      if (this.authService.isAuthenticated()) {
        this.connect();
      }
    });
  }

  private connect(): void {
    // Évite une double connexion si une est déjà en cours ou ouverte
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = this.authService.getToken();
    if (!token) return;

    const url = `${environment.wsBaseUrl}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected.set(true);
      this.connectedSince.set(Date.now());
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.event) {
          case 'raw_detection': {
            const det = payload.data as RawDetection;
            this.rawDetections$.next(det);
            this.totalDetections.update((n) => n + 1);
            break;
          }
          case 'camera_positions':
            this.cameraConfigs.set(payload.data as CameraGpsConfig[]);
            break;
          case 'imu_update':
            this.storeImuSample(payload.data as Omit<ImuSample, 'receivedAt'>);
            break;
          case 'camera_preview':
            this.storePreview(payload.data as {
              cameraId: string;
              jpegBase64: string;
              mime?: string;
              timestamp?: number;
            });
            break;
          case 'track_update': {
            const track = payload.data as TrackUpdate;
            this.trackUpdates$.next(track);
            if (!this.seenTrackIds.has(track.trackId)) {
              this.seenTrackIds.add(track.trackId);
              this.activeTrackCount.update((n) => n + 1);
            }
            break;
          }
          case 'alert':
            this.alerts$.next(payload.data as AlertEvent);
            break;
        }
      } catch {
        console.error('RealtimeService: message WebSocket invalide', event.data);
      }
    };

    ws.onclose = (event) => {
      this.connected.set(false);
      this.connectedSince.set(null);
      this.ws = null;

      // Code 4001 = token refusé par le serveur → déconnexion forcée, pas de reconnexion
      if (event.code === 4001) {
        this.authService.clearToken();
        return;
      }

      if (!this.destroyed && this.authService.isAuthenticated()) {
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => ws.close();
  }

  imuOf(cameraId: string): ImuSample | undefined {
    return this.imuByCamera()[cameraId];
  }

  previewOf(cameraId: string): CameraPreview | undefined {
    return this.previewByCamera()[cameraId];
  }

  private storeImuSample(
    // calibration/valid absents si le VPS n'est pas à jour.
    sample: Omit<ImuSample, 'receivedAt' | 'calibration' | 'valid'> &
      Partial<Pick<ImuSample, 'calibration' | 'valid'>>,
  ): void {
    if (!sample?.cameraId) return;
    const stored: ImuSample = {
      cameraId: sample.cameraId,
      headingDeg: sample.headingDeg,
      elevationDeg: sample.elevationDeg,
      rollDeg: sample.rollDeg,
      calibration: sample.calibration ?? null,
      valid: sample.valid ?? true,
      timestamp: sample.timestamp,
      receivedAt: Date.now(),
    };
    this.imuByCamera.update((current) => ({
      ...current,
      [stored.cameraId]: stored,
    }));
  }

  private storePreview(sample: {
    cameraId: string;
    jpegBase64: string;
    mime?: string;
    timestamp?: number;
  }): void {
    if (!sample?.cameraId || !sample.jpegBase64) return;
    let bytes: Uint8Array;
    try {
      const bin = atob(sample.jpegBase64);
      bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    } catch {
      return;
    }
    const mime = sample.mime || 'image/jpeg';
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const src = URL.createObjectURL(blob);
    this.previewByCamera.update((current) => {
      const prev = current[sample.cameraId];
      if (prev) URL.revokeObjectURL(prev.src);
      return {
        ...current,
        [sample.cameraId]: {
          cameraId: sample.cameraId,
          src,
          receivedAt: Date.now(),
        },
      };
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    const previews = this.previewByCamera();
    for (const preview of Object.values(previews)) {
      URL.revokeObjectURL(preview.src);
    }
  }
}
