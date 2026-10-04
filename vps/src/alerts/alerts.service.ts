import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  Alert,
  AlertType,
  AlertCategory,
  AlertStatus,
  CameraState,
} from './alert-types';
import {
  ALERT_STORE,
  AlertStore,
  CAMERA_LOG_STORE,
  CameraStateLogStore,
} from './alert-store.interface';
import { EventsGateway } from '../realtime/events.gateway';
import { DiscordNotificationChannel } from '../discord-notification.channel';
import {
  CameraHealthService,
  CameraHealthStatus,
  SystemHealthUpdate,
} from '../cameras/camera-health.service';
import { formatDuration } from '../discord-formatter';

export interface TrackAlertInput {
  trackId: string;
  classification?: string;
  cameraIds?: string[];
  confidence?: number;
  lat?: number;
  lng?: number;
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
  private readonly cameraIncidentStartTime = new Map<string, number>(); // cameraId -> startTime
  private readonly droneNotifiedTracks = new Set<string>(); // trackIds with sent Discord notification

  private systemBlindAlertId: string | null = null;
  private systemBlindStartTime: number | null = null;
  private trackCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(ALERT_STORE) private readonly alertStore: AlertStore,
    @Inject(CAMERA_LOG_STORE) private readonly cameraLogStore: CameraStateLogStore,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
    private readonly discordChannel: DiscordNotificationChannel,
    private readonly cameraHealth: CameraHealthService,
  ) {
    this.cameraHealth.onStateChange((status, globalUpdate) => {
      this.handleCameraStateChange(status, globalUpdate);
    });

    this.trackCleanupTimer = setInterval(
      () => void this.cleanupLostTracks().catch((err) => this.logger.error(`Erreur cleanup tracks : ${err}`)),
      1000,
    );
  }

  /**
   * Entrée de données depuis la détection de pistes (Feature B).
   */
  async processTrackAlert(track: TrackAlertInput): Promise<void> {
    this.activeTrackLastSeen.set(track.trackId, Date.now());

    const confidence = track.confidence ?? 0.5;
    const isDrone = track.classification === 'drone';
    const cameraIds = track.cameraIds || [];

    let alertId = this.activeTrackAlerts.get(track.trackId);

    if (!alertId) {
      // Étape 1 : Création de la nouvelle alerte d'objet détecté
      let category: AlertCategory = AlertCategory.OBJECT_DETECTED;
      let type: AlertType = AlertType.INFO;
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

      let alert: Alert;
      try {
        alert = await this.alertStore.create({
          type,
          category,
          status: AlertStatus.NEW,
          message,
          trackId: track.trackId,
          cameraIds,
          confidence,
        });
      } catch (err) {
        this.logger.warn(`Échec de persistance de l'alerte piste : ${err}`);
        alert = {
          id: `temp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          type,
          category,
          status: AlertStatus.NEW,
          message,
          trackId: track.trackId,
          cameraIds,
          cameraState: null,
          confidence,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      alertId = alert.id;
      this.activeTrackAlerts.set(track.trackId, alertId);
      this.eventsGateway.broadcast('alert', alert);

      // Envoi Discord unique par incident
      if (type === AlertType.CRITICAL && !this.droneNotifiedTracks.has(track.trackId)) {
        this.droneNotifiedTracks.add(track.trackId);
        void this.discordChannel.send({
          title: '🚨 DRONE CONFIRMÉ',
          description: message,
          severity: 'CRITICAL',
          category: AlertCategory.DRONE_CONFIRMED,
          alertId: alert.id,
          cameraIds,
          confidence,
          lat: track.lat,
          lng: track.lng,
          timestamp: new Date(),
        });
      }
    } else {
      // Étape 2 : Évolution de l'alerte existante (Le niveau ne redescend JAMAIS)
      const existing = await this.alertStore.findUnique(alertId).catch(() => null);
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

        if (!this.droneNotifiedTracks.has(track.trackId)) {
          this.droneNotifiedTracks.add(track.trackId);
          void this.discordChannel.send({
            title: '🚨 DRONE CONFIRMÉ',
            description: nextMessage,
            severity: 'CRITICAL',
            category: AlertCategory.DRONE_CONFIRMED,
            alertId,
            cameraIds,
            confidence,
            lat: track.lat,
            lng: track.lng,
            timestamp: new Date(),
          });
        }
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
        const updated = await this.alertStore.update(alertId, {
          type: nextType,
          category: nextCategory,
          message: nextMessage,
          confidence,
          cameraIds,
        }).catch(() => null);

        if (updated) {
          this.eventsGateway.broadcast('alert_updated', updated);
        }
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
    void this.processCameraStateChange(status, globalUpdate).catch((err) => {
      this.logger.error(`Erreur processCameraStateChange : ${err}`);
    });
  }

  private async processCameraStateChange(
    status: CameraHealthStatus,
    globalUpdate: SystemHealthUpdate,
  ): Promise<void> {
    // 1. Enregistrement dans le log d'état
    try {
      await this.cameraLogStore.createStateLog({
        cameraId: status.cameraId,
        state: status.state,
        previousState: status.previousState,
        reason: status.reason,
        lumMean: status.lumMean,
        lumStddev: status.lumStddev,
        exposureUs: status.exposureUs,
        gainDb: status.gainDb,
      });
    } catch (err) {
      this.logger.warn(`Échec de journalisation CameraStateLog : ${err}`);
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
        try {
          await this.alertStore.update(existingAlertId, {
            status: AlertStatus.RESOLVED,
            resolvedAt: new Date().toISOString(),
          });
        } catch (err) {
          this.logger.warn(`Échec de résolution de l'alerte caméra : ${err}`);
        }
        this.cameraIncidentAlerts.delete(status.cameraId);
      }

      // Notification Discord de rétablissement avec référence à l'incident d'origine et durée
      if (status.previousState === CameraState.HORS_SERVICE || status.previousState === CameraState.DEGRADED_BLIND) {
        const startTime = this.cameraIncidentStartTime.get(status.cameraId) || Date.now();
        const durationMs = Date.now() - startTime;
        this.cameraIncidentStartTime.delete(status.cameraId);

        void this.discordChannel.send({
          title: `✅ CAMÉRA RÉTABLIE — ${status.displayName}`,
          description: `Fonctionnement nominal rétabli après ${formatDuration(durationMs)}.`,
          severity: 'INFO',
          category: AlertCategory.CAMERA_RECOVERED,
          incidentDurationMs: durationMs,
          cameraIds: [status.cameraId],
          reliability: globalUpdate.reliability,
          timestamp: new Date(),
        });
      }
    }

    if (status.state !== CameraState.OK && status.state !== CameraState.EN_ATTENTE) {
      let alert: Alert;
      try {
        alert = await this.alertStore.create({
          type,
          category,
          status: AlertStatus.NEW,
          message,
          cameraIds: [status.cameraId],
          cameraState: status.state,
        });
      } catch (err) {
        this.logger.warn(`Échec de création d'alerte caméra : ${err}`);
        alert = {
          id: `temp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          type,
          category,
          status: AlertStatus.NEW,
          message,
          trackId: null,
          cameraIds: [status.cameraId],
          cameraState: status.state,
          confidence: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      this.cameraIncidentAlerts.set(status.cameraId, alert.id);
      this.eventsGateway.broadcast('alert', alert);

      if (isCritical) {
        this.cameraIncidentStartTime.set(status.cameraId, Date.now());
        const title =
          status.state === CameraState.HORS_SERVICE
            ? `📷 ${status.displayName} HORS SERVICE`
            : `📷 ${status.displayName} MASQUÉE`;

        void this.discordChannel.send({
          title,
          description: message,
          severity: 'CRITICAL',
          category: AlertCategory.CAMERA_STATUS,
          alertId: alert.id,
          cameraIds: [status.cameraId],
          cause: status.reason,
          reliability: globalUpdate.reliability,
          timestamp: new Date(),
        });
      }
    }

    // 3. Gestion de l'alerte SYSTÈME AVEUGLE (Fiabilité globale ROUGE <= 1 caméra OK)
    if (globalUpdate.reliability === 'RED' && !this.systemBlindAlertId) {
      let blindAlert: Alert;
      try {
        blindAlert = await this.alertStore.create({
          type: AlertType.CRITICAL,
          category: AlertCategory.SYSTEM_BLIND,
          status: AlertStatus.NEW,
          message: `🚨 ${globalUpdate.message}`,
        });
      } catch (err) {
        this.logger.warn(`Échec de création d'alerte système aveugle : ${err}`);
        blindAlert = {
          id: `temp-blind-${Date.now()}`,
          type: AlertType.CRITICAL,
          category: AlertCategory.SYSTEM_BLIND,
          status: AlertStatus.NEW,
          message: `🚨 ${globalUpdate.message}`,
          trackId: null,
          cameraIds: [],
          cameraState: null,
          confidence: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      this.systemBlindAlertId = blindAlert.id;
      this.systemBlindStartTime = Date.now();
      this.eventsGateway.broadcast('alert', blindAlert);

      void this.discordChannel.send({
        title: '🚨 SYSTÈME AVEUGLE',
        description: globalUpdate.message,
        severity: 'CRITICAL',
        category: AlertCategory.SYSTEM_BLIND,
        alertId: blindAlert.id,
        reliability: 'RED',
        timestamp: new Date(),
      });
    } else if (
      globalUpdate.reliability !== 'RED' &&
      this.systemBlindAlertId
    ) {
      try {
        await this.alertStore.update(this.systemBlindAlertId, {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn(`Échec de résolution alerte système aveugle : ${err}`);
      }

      const startTime = this.systemBlindStartTime || Date.now();
      const durationMs = Date.now() - startTime;
      this.systemBlindAlertId = null;
      this.systemBlindStartTime = null;

      void this.discordChannel.send({
        title: '✅ SYSTÈME RESTAURÉ',
        description: `Fiabilité 3D restaurée après ${formatDuration(durationMs)} (${globalUpdate.message}).`,
        severity: 'INFO',
        category: AlertCategory.SYSTEM_BLIND,
        incidentDurationMs: durationMs,
        reliability: globalUpdate.reliability,
        timestamp: new Date(),
      });
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
    const alert = await this.alertStore.findUnique(alertId).catch(() => null);

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

    const updated = await this.alertStore.update(alertId, {
      status: AlertStatus.ACKNOWLEDGED,
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: operatorUsername,
    });

    if (!updated) {
      throw new BadRequestException('Échec d\'actualisation de l\'alerte');
    }

    this.logger.log(
      `Alerte ${alertId} acquittée par l'opérateur '${operatorUsername}'`,
    );

    // Diffusion de la synchro à tous les clients WS connectés
    this.eventsGateway.broadcast('alert_updated', updated);

    return updated;
  }

  list(options: ListAlertsOptions = {}): Promise<Alert[]> {
    return this.alertStore.findMany(options);
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
            const updated = await this.alertStore.update(alertId, {
              status: AlertStatus.RESOLVED,
              resolvedAt: new Date().toISOString(),
            });
            if (updated) {
              this.eventsGateway.broadcast('alert_updated', updated);
            }
          } catch {
            // Ignorer
          }
          this.activeTrackAlerts.delete(trackId);
        }
        this.activeTrackLastSeen.delete(trackId);
        this.droneNotifiedTracks.delete(trackId);
      }
    }
  }
}
