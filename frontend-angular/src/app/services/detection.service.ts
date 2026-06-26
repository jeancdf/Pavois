import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { RawDetection } from '../models/raw-detection.model';

const RECONNECT_DELAY_MS = 2000;

@Injectable({ providedIn: 'root' })
export class DetectionService implements OnDestroy {
  readonly connected = signal(false);
  readonly detections$ = new Subject<RawDetection>();

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
        if (payload.event === 'raw_detection') {
          this.detections$.next(payload.data as RawDetection);
        }
      } catch {
        console.error('DetectionService: message WebSocket invalide', event.data);
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
}
