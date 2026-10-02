import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AlertsCleanUpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsCleanUpService.name);
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);

    try {
      const deletedAlerts = await this.prisma.alert.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      });
      const deletedLogs = await this.prisma.cameraStateLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      });

      if (deletedAlerts.count > 0 || deletedLogs.count > 0) {
        this.logger.log(
          `Purge automatique (rétention ${retentionDays}j) : ${deletedAlerts.count} alertes et ${deletedLogs.count} logs d'état supprimés.`,
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
