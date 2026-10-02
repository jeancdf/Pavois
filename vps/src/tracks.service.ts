import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Track, TrackVerdict } from './track-types';
import { TRACK_STORE, TrackStore } from './stores/track-store.interface';

export interface RecordableTrack {
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  classification?: string;
  timestamp: number;
}

export interface ListTracksOptions {
  limit?: number;
  before?: string;
  classification?: string;
  /** 'UNREVIEWED' selects verdict IS NULL. */
  verdict?: TrackVerdict | 'UNREVIEWED';
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    @Inject(TRACK_STORE) private readonly trackStore: TrackStore,
  ) {}

  async record(track: RecordableTrack): Promise<void> {
    try {
      await this.trackStore.create({
        trackId: track.trackId,
        lat: track.lat,
        lng: track.lng,
        alt: track.alt,
        classification: track.classification ?? null,
        timestampUs: track.timestamp,
      });
    } catch (error) {
      this.logger.warn(
        `Échec de journalisation de la piste ${track.trackId} : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async list(options: ListTracksOptions = {}): Promise<Track[]> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let list = await this.trackStore.findMany({ limit });

    if (options.classification) {
      list = list.filter((t) => t.classification === options.classification);
    }
    if (options.verdict === 'UNREVIEWED') {
      list = list.filter((t) => !t.verdict);
    } else if (options.verdict) {
      list = list.filter((t) => t.verdict === options.verdict);
    }

    return list.slice(0, limit);
  }

  async setVerdict(id: string, verdict: TrackVerdict, note?: string): Promise<Track> {
    const existing = await this.trackStore.findUnique(id);
    if (!existing) {
      throw new NotFoundException(`Piste introuvable : ${id}`);
    }
    const updated = await this.trackStore.updateVerdict(id, {
      verdict,
      verdictNote: note ?? null,
    });

    if (!updated) {
      throw new NotFoundException(`Échec d'actualisation de la piste : ${id}`);
    }

    return updated;
  }
}
