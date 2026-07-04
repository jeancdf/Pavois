import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { RawDetection } from '../models/raw-detection.model';
import { CameraPosition } from '../models/world-position.model';
import { TrackUpdate } from '../models/track-update.model';
import { CAMERAS_GPS_CONFIG, FALLBACK_RANGE_M } from '../config/cameras.config';
import { llaToLocalEnu } from '../utils/geo';

const RECONNECT_DELAY_MS = 2000;

/**
 * Point d'entrée unique vers le WebSocket de la passerelle (NestJS, ou son
 * mock local) : une seule connexion, démultiplexée par `payload.event`.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  readonly connected = signal(false);
  readonly cameras = signal<CameraPosition[]>(this.buildCamerasFromGpsConfig());
  readonly rawDetections$ = new Subject<RawDetection>();
  readonly trackUpdates$ = new Subject<TrackUpdate>();

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(environment.wsUrl);
    this.ws = ws;

    ws.onopen = () => this.connected.set(true);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.event) {
          case 'raw_detection':
            this.rawDetections$.next(payload.data as RawDetection);
            break;
          case 'camera_positions':
            this.cameras.set(payload.data as CameraPosition[]);
            break;
          case 'track_update':
            this.trackUpdates$.next(payload.data as TrackUpdate);
            break;
        }
      } catch {
        console.error('RealtimeService: message WebSocket invalide', event.data);
      }
    };

    ws.onclose = () => {
      this.connected.set(false);
      if (!this.destroyed) {
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

  /** Positions caméra connues statiquement (cf. cameras.config.ts), en GPS direct. */
  private buildCamerasFromGpsConfig(): CameraPosition[] {
    const cameras = CAMERAS_GPS_CONFIG.map((cam) => ({
      id: cam.id,
      lat: cam.lat,
      lon: cam.lon,
      azimuthDeg: cam.headingDeg,
      fovDeg: cam.fovDeg,
      rangeM: FALLBACK_RANGE_M,
    }));

    // Spécifique à ce test à très courte base : la portée affichée est la
    // distance entre les deux caméras, pour que les cônes restent visibles et
    // comparables. Ce n'est PAS une portée opérationnelle réelle.
    if (CAMERAS_GPS_CONFIG.length >= 2) {
      const [a, b] = CAMERAS_GPS_CONFIG;
      const { x, y } = llaToLocalEnu(b.lat, b.lon, b.alt, { lat: a.lat, lng: a.lon, alt: a.alt });
      const baselineM = Math.hypot(x, y);
      cameras.forEach((cam) => (cam.rangeM = baselineM));
    }

    return cameras;
  }
}
