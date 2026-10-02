import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EventsGateway } from './events.gateway';
import {
  Alert,
  AlertType,
  AlertCategory,
  AlertStatus,
  CameraState,
} from '@prisma/client';
import { DiscordNotificationChannel } from './discord-notification.channel';
import {
  CameraHealthService,
  CameraHealthStatus,
  SystemHealthUpdate,
} from './camera-health.service';

export interface TrackAlertInput {
  trackId: string;
  classification?: string;
  cameraIds?: string[];
  confidence?: number;
}

export interface ListAlertsOptions {
  limit?: number;
  before?: string;
  status?: AlertStatus;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly activeTrackAlerts = new Map<string, string>(); // trackId -> alertId
  private readonly activeTrackLastSeen = new Map<string, number>();
  private readonly cameraIncidentAlerts = new Map<string, string>(); // cameraId -> alertId
  private systemBlindAlertId: string | null = null;
  private trackCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly discordChannel: DiscordNotificationChannel,
    private readonly cameraHealth: CameraHealthService,
  ) {
    // Écoute des changements d'état des caméras
    this.cameraHealth.onStateChange((status, globalUpdate) => {
      this.handleCameraStateChange(status, globalUpdate);
    });

    // Nettoyage périodique des pistes perdues (> 5s)
    this.trackCleanupTimer = setInterval(() => this.cleanupLostTracks(), 2000);
  }

  /**
   * Traitement évolutif des événements d'objets volants (Feature B).
   * Seuil 1 : OBJET DÉTECTÉ (info, écran)
   * Seuil 2 : À VÉRIFIER (warning, 40-75%)
   * Seuil 3 : DRONE CONFIRMÉ (critical, >75% + 3-points + Discord)
   */
  async onTrackUpdate(track: TrackAlertInput): Promise<void> {
    const now = Date.now();
    this.activeTrackLastSeen.set(track.trackId, now);

    const confidence = track.confidence ?? 0.5;
    const isDrone = track.classification === 'drone';
    const cameraIds = track.cameraIds || [];

    let alertId = this.activeTrackAlerts.get(track.trackId);

    if (!alertId) {
      // Étape 1 : Création de la nouvelle alerte d'objet détecté
      let category = AlertCategory.OBJECT_DETECTED;
      let type = AlertType.INFO;
      let message = `Objet détecté (Piste ${track.trackId})`;

      if (confidence >= 0.75 && isDrone) {
        category = AlertCategory.DRONE_CONFIRMED;
        type = AlertType.CRITICAL;
        message = `DRONE CONFIRMÉ — Piste ${track.trackId} (Confiance: ${(confidence * 100).toFixed(0)}%)`;
      } else if (confidence >= 0.4 || isDrone) {
        category = AlertCategory.TO_VERIFY;
        type = AlertType.WARNING;
        message = `À VÉRIFIER — Piste ${track.trackId} (Levée de doute requise)`;
      }

      const alert = await this.prisma.alert.create({
        data: {
          type,
          category,
          status: AlertStatus.NEW,
          message,
          trackId: track.trackId,
          cameraIds,
          confidence,
        },
      });

      alertId = alert.id;
      this.activeTrackAlerts.set(track.trackId, alertId);
      this.eventsGateway.broadcast('alert', alert);

      if (type === AlertType.CRITICAL) {
        void this.discordChannel.send({
          title: '🚨 DRONE CONFIRMÉ',
          description: message,
          severity: 'CRITICAL',
          timestamp: new Date(),
        });
      }
    } else {
      // Étape 2 : Évolution de l'alerte existante (Le niveau ne redescend JAMAIS)
      const existing = await this.prisma.alert.findUnique({
        where: { id: alertId },
      });
      if (!existing || existing.status === AlertStatus.RESOLVED) return;

      let nextCategory = existing.category;
      let nextType = existing.type;
      let nextMessage = existing.message;
      let shouldUpdate = false;

      if (
        confidence >= 0.75 &&
        isDrone &&
        existing.category !== AlertCategory.DRONE_CONFIRMED
      ) {
        nextCategory = AlertCategory.DRONE_CONFIRMED;
        nextType = AlertType.CRITICAL;
        nextMessage = `DRONE CONFIRMÉ — Piste ${track.trackId} (Confiance: ${(confidence * 100).toFixed(0)}%)`;
        shouldUpdate = true;

        void this.discordChannel.send({
          title: '🚨 DRONE CONFIRMÉ',
          description: nextMessage,
          severity: 'CRITICAL',
          timestamp: new Date(),
        });
      } else if (
        confidence >= 0.4 &&
        existing.category === AlertCategory.OBJECT_DETECTED
      ) {
        nextCategory = AlertCategory.TO_VERIFY;
        nextType = AlertType.WARNING;
        nextMessage = `À VÉRIFIER — Piste ${track.trackId} (Levée de doute requise)`;
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        const updated = await this.prisma.alert.update({
          where: { id: alertId },
          data: {
            type: nextType,
            category: nextCategory,
            message: nextMessage,
            confidence,
            cameraIds,
          },
        });
        this.eventsGateway.broadcast('alert_updated', updated);
      }
    }
  }

  /**
   * Gestion des transitions d'état des caméras (Feature A).
   */
  private handleCameraStateChange(
    status: CameraHealthStatus,
    globalUpdate: SystemHealthUpdate,
  ): void {
    void this.processCameraStateChange(status, globalUpdate);
  }

  private async processCameraStateChange(
    status: CameraHealthStatus,
    globalUpdate: SystemHealthUpdate,
  ): Promise<void> {
    // 1. Enregistrement dans le log d'état
    try {
      await this.prisma.cameraStateLog.create({
        data: {
          cameraId: status.cameraId,
          state: status.state,
          previousState: status.previousState,
          reason: status.reason,
          lumMean: status.lumMean,
          lumStddev: status.lumStddev,
          exposureUs: status.exposureUs,
          gainDb: status.gainDb,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Échec de journalisation CameraStateLog : ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. Émission d'alerte selon la gravité de l'état
    let type: AlertType = AlertType.INFO;
    let category: AlertCategory = AlertCategory.CAMERA_STATUS;
    let message = `Caméra ${status.displayName} : ${status.state} (${status.reason})`;
    let isCritical = false;

    if (status.state === CameraState.HORS_SERVICE) {
      type = AlertType.CRITICAL;
      isCritical = true;
      message = `🚨 CAMÉRA HORS SERVICE — ${status.displayName} (${status.reason})`;
    } else if (status.state === CameraState.DEGRADED_BLIND) {
      type = AlertType.CRITICAL;
      isCritical = true;
      message = `🚨 CAMÉRA MASQUÉE — ${status.displayName} (${status.reason})`;
    } else if (status.state === CameraState.DEGRADED_FROZEN) {
      type = AlertType.WARNING;
      message = `⚠️ FLUX FIGÉ — ${status.displayName} (${status.reason})`;
    } else if (status.state === CameraState.REDUCED_VISIBILITY_NIGHT) {
      type = AlertType.INFO;
      message = `ℹ️ VISIBILITÉ RÉDUITE (Nuit/Brouillard) — ${status.displayName}`;
    } else if (status.state === CameraState.OK) {
      type = AlertType.INFO;
      category = AlertCategory.CAMERA_RECOVERED;
      message = `✅ CAMÉRA RÉTABLIE — ${status.displayName}`;

      // Résolution de l'incident précédent s'il existait
      const existingAlertId = this.cameraIncidentAlerts.get(status.cameraId);
      if (existingAlertId) {
        await this.prisma.alert.update({
          where: { id: existingAlertId },
          data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
        });
        this.cameraIncidentAlerts.delete(status.cameraId);
      }

      // Notification Discord de rétablissement si l'incident précédent était critique
      if (status.previousState === CameraState.HORS_SERVICE || status.previousState === CameraState.DEGRADED_BLIND) {
        void this.discordChannel.send({
          title: '✅ CAMÉRA RÉTABLIE',
          description: message,
          severity: 'INFO',
          timestamp: new Date(),
        });
      }
    }

    if (status.state !== CameraState.OK) {
      const alert = await this.prisma.alert.create({
        data: {
          type,
          category,
          status: AlertStatus.NEW,
          message,
          cameraIds: [status.cameraId],
          cameraState: status.state,
        },
      });

      this.cameraIncidentAlerts.set(status.cameraId, alert.id);
      this.eventsGateway.broadcast('alert', alert);

      if (isCritical) {
        void this.discordChannel.send({
          title: '🚨 ALERTE CRITIQUE CAMÉRA',
          description: message,
          severity: 'CRITICAL',
          timestamp: new Date(),
        });
      }
    }

    // 3. Gestion de l'alerte SYSTÈME AVEUGLE (Fiabilité globale ROUGE <= 1 caméra OK)
    if (globalUpdate.reliability === 'RED' && !this.systemBlindAlertId) {
      const blindAlert = await this.prisma.alert.create({
        data: {
          type: AlertType.CRITICAL,
          category: AlertCategory.SYSTEM_BLIND,
          status: AlertStatus.NEW,
          message: `🚨 ${globalUpdate.message}`,
        },
      });
      this.systemBlindAlertId = blindAlert.id;
      this.eventsGateway.broadcast('alert', blindAlert);

      void this.discordChannel.send({
        title: '🚨 SYSTÈME AVEUGLE',
        description: globalUpdate.message,
        severity: 'CRITICAL',
        timestamp: new Date(),
      });
    } else if (
      globalUpdate.reliability !== 'RED' &&
      this.systemBlindAlertId
    ) {
      await this.prisma.alert.update({
        where: { id: this.systemBlindAlertId },
        data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
      });
      this.systemBlindAlertId = null;
    }

    // Diffusion WS de l'état caméras mis à jour
    this.eventsGateway.broadcast('camera_status_update', {
      status,
      globalUpdate,
    });
  }

  /**
   * Action d'acquittement sécurisée et authentifiée par un opérateur.
   */
  async acknowledge(alertId: string, operatorUsername: string): Promise<Alert> {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });

    if (!alert) {
      throw new NotFoundException(`Alerte non trouvée : ${alertId}`);
    }

    // Refuser l'acquittement sur une alerte déjà RESOLVED
    if (alert.status === AlertStatus.RESOLVED) {
      throw new BadRequestException(
        'Impossible d\'acquitter une alerte déjà résolue',
      );
    }

    // Idempotent si déjà ACKNOWLEDGED
    if (alert.status === AlertStatus.ACKNOWLEDGED) {
      return alert;
    }

    const updated = await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: AlertStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedBy: operatorUsername,
      },
    });

    this.logger.log(
      `Alerte ${alertId} acquittée par l'opérateur '${operatorUsername}'`,
    );

    // Diffusion de la synchro à tous les clients WS connectés
    this.eventsGateway.broadcast('alert_updated', updated);

    return updated;
  }

  list(options: ListAlertsOptions = {}): Promise<Alert[]> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    return this.prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: options.status ? { status: options.status } : undefined,
      ...(options.before ? { cursor: { id: options.before }, skip: 1 } : {}),
    });
  }

  /**
   * Résolution automatique des pistes perdues (> 5s).
   */
  private async cleanupLostTracks() {
    const now = Date.now();
    const timeoutMs =
      (Number(process.env.OBJECT_LOST_TIMEOUT_SECONDS) || 5) * 1000;

    for (const [trackId, lastSeen] of this.activeTrackLastSeen.entries()) {
      if (now - lastSeen > timeoutMs) {
        const alertId = this.activeTrackAlerts.get(trackId);
        if (alertId) {
          try {
            const updated = await this.prisma.alert.update({
              where: { id: alertId },
              data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
            });
            this.eventsGateway.broadcast('alert_updated', updated);
          } catch {
            // Ignorer si déjà supprimée
          }
          this.activeTrackAlerts.delete(trackId);
        }
        this.activeTrackLastSeen.delete(trackId);
      }
    }
  }
}
