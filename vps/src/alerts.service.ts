import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EventsGateway } from './events.gateway';
import type { Alert } from '@prisma/client';

export type AlertType = 'info' | 'warning' | 'alert';

export interface TrackAlertInput {
  trackId: string;
  classification?: string;
  cameraId?: string;
}

export interface ListAlertsOptions {
  limit?: number;
  before?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Règles d'alerte déplacées du frontend (ex alert-trigger.service.ts) :
 * calculées une seule fois côté serveur, persistées, et diffusées à tous les
 * clients — sinon un onglet fermé au moment de l'événement perdait l'alerte
 * pour toujours.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly seenTrackIds = new Set<string>();
  private readonly droneAlertedIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  onTrackUpdate(track: TrackAlertInput): void {
    if (!this.seenTrackIds.has(track.trackId)) {
      this.seenTrackIds.add(track.trackId);
      const classifSuffix = track.classification
        ? ` (${track.classification.toUpperCase()})`
        : '';
      this.fire(
        'alert',
        `Nouvelle piste détectée : ${track.trackId}${classifSuffix}`,
        { trackId: track.trackId, cameraId: track.cameraId },
      );
    }

    if (
      track.classification === 'drone' &&
      !this.droneAlertedIds.has(track.trackId)
    ) {
      this.droneAlertedIds.add(track.trackId);
      this.fire('alert', `DRONE confirmé — piste ${track.trackId}`, {
        trackId: track.trackId,
        cameraId: track.cameraId,
      });
    }
  }

  list(options: ListAlertsOptions = {}): Promise<Alert[]> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    return this.prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(options.before ? { cursor: { id: options.before }, skip: 1 } : {}),
    });
  }

  private fire(
    type: AlertType,
    message: string,
    extra: { trackId?: string; cameraId?: string },
  ): void {
    this.eventsGateway.broadcast('alert', { type, message, ...extra });
    // Diffusion immédiate, persistance en tâche de fond (jamais bloquante).
    void this.persist(type, message, extra);
  }

  private async persist(
    type: AlertType,
    message: string,
    extra: { trackId?: string; cameraId?: string },
  ): Promise<void> {
    try {
      await this.prisma.alert.create({
        data: {
          type,
          message,
          trackId: extra.trackId ?? null,
          cameraId: extra.cameraId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Échec de journalisation de l'alerte : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
