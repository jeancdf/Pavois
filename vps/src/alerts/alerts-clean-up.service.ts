import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ALERT_STORE, AlertStore } from '../stores/alert-store.interface';

@Injectable()
export class AlertsCleanUpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsCleanUpService.name);
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(ALERT_STORE) private readonly alertStore: AlertStore,
  ) {}

  onModuleInit() {
    // Exécution initiale au démarrage puis toutes les 24 heures
    void this.purgeOldAlerts();
    this.purgeInterval = setInterval(
      () => void this.purgeOldAlerts(),
      24 * 3600 * 1000,
    );
  }

  async purgeOldAlerts(): Promise<void> {
    const retentionDays = Number(process.env.ALERT_RETENTION_DAYS) || 30;

    try {
      const purgedCount = await this.alertStore.purgeOlderThan(retentionDays);
      if (purgedCount > 0) {
        this.logger.log(
          `Purge automatique JSONL (rétention ${retentionDays}j) : ${purgedCount} alertes purgées.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Échec de la purge automatique des alertes : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy() {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
    }
  }
}
