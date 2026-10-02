import { Injectable } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

// Au plus un aperçu par caméra toutes les N ms. 150 ménage le lien montant en
// production ; un banc local peut mettre 0 pour suivre la cadence caméra.
const MIN_INTERVAL_MS = previewMinIntervalMs();
const MAX_BYTES = 64 * 1024;

@Injectable()
export class PreviewService {
  private readonly lastMs = new Map<string, number>();

  constructor(private readonly eventsGateway: EventsGateway) {}

  ingest(cameraId: string, jpeg: Buffer): boolean {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(cameraId)) return false;
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 8 || jpeg.length > MAX_BYTES) {
      return false;
    }
    const jpegOk = jpeg[0] === 0xff && jpeg[1] === 0xd8;
    if (!jpegOk) return false;

    const now = Date.now();
    const prev = this.lastMs.get(cameraId) ?? 0;
    if (now - prev < MIN_INTERVAL_MS) return true;
    this.lastMs.set(cameraId, now);

    this.eventsGateway.broadcast('camera_preview', {
      cameraId,
      timestamp: now,
      mime: 'image/jpeg',
      jpegBase64: jpeg.toString('base64'),
    });
    return true;
  }
}

function previewMinIntervalMs(): number {
  const value = Number.parseInt(process.env.PREVIEW_MIN_INTERVAL_MS ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 150;
}
