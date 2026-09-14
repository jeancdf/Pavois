import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TrackVerdict } from '@prisma/client';
import type { Track } from '@prisma/client';

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

/**
 * Journal des pistes confirmées (pipeline de fusion ou passthrough `obj*`),
 * pour analyser la précision après coup et repérer les mauvaises détections.
 */
@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Ne doit jamais faire échouer le pipeline UDP : la persistance est un
  // journal, pas le chemin critique de diffusion temps réel.
  async record(track: RecordableTrack): Promise<void> {
    try {
      await this.prisma.track.create({
        data: {
          trackId: track.trackId,
          lat: track.lat,
          lng: track.lng,
          alt: track.alt,
          classification: track.classification ?? null,
          timestampUs: track.timestamp,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Échec de journalisation de la piste ${track.trackId} : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  list(options: ListTracksOptions = {}): Promise<Track[]> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const verdictFilter =
      options.verdict === 'UNREVIEWED'
        ? { verdict: null }
        : options.verdict
          ? { verdict: options.verdict }
          : {};
    return this.prisma.track.findMany({
      where: {
        ...(options.classification ? { classification: options.classification } : {}),
        ...verdictFilter,
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      ...(options.before ? { cursor: { id: options.before }, skip: 1 } : {}),
    });
  }

  async setVerdict(id: string, verdict: TrackVerdict, note?: string): Promise<Track> {
    const existing = await this.prisma.track.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Piste introuvable : ${id}`);
    }
    return this.prisma.track.update({
      where: { id },
      data: { verdict, reviewNote: note ?? null, reviewedAt: new Date() },
    });
  }
}
