import { Injectable, OnDestroy, computed, effect, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { RawDetection } from '../models/raw-detection.model';
import { TrackUpdate } from '../models/track-update.model';
import { CameraGpsConfig, buildCameraPositions } from '../config/cameras.config';
import { AuthService } from './auth.service';

const RECONNECT_DELAY_MS = 2000;

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  readonly connected = signal(false);
  readonly connectedSince = signal<number | null>(null);
  // Positions stockées par le backend : envoyées à la connexion puis à chaque modification
  readonly cameraConfigs = signal<CameraGpsConfig[]>([]);
  readonly cameras = computed(() => buildCameraPositions(this.cameraConfigs()));
  readonly rawDetections$ = new Subject<RawDetection>();
  readonly trackUpdates$ = new Subject<TrackUpdate>();

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
          case 'track_update': {
            const track = payload.data as TrackUpdate;
            this.trackUpdates$.next(track);
            if (!this.seenTrackIds.has(track.trackId)) {
              this.seenTrackIds.add(track.trackId);
              this.activeTrackCount.update((n) => n + 1);
            }
            break;
          }
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

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
