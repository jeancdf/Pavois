import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Alert, AlertStatus, CameraStateLog } from '../alert-types';
import {
  AlertStore,
  CameraStateLogStore,
  CreateAlertData,
  ListAlertsOptions,
  UpdateAlertData,
} from './alert-store.interface';

@Injectable()
export class JsonlAlertStore implements AlertStore, CameraStateLogStore, OnModuleInit {
  private readonly logger = new Logger(JsonlAlertStore.name);
  private readonly dataDir: string;
  private readonly alertsFilePath: string;
  private readonly cameraLogsFilePath: string;
  private readonly maxMemoryItems: number;

  private readonly memoryAlerts = new Map<string, Alert>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.dataDir = path.resolve(process.env.ALERTS_DATA_DIR || './data');
    this.alertsFilePath = path.join(this.dataDir, 'alerts.jsonl');
    this.cameraLogsFilePath = path.join(this.dataDir, 'camera-states.jsonl');
    this.maxMemoryItems = Number(process.env.ALERT_MAX_MEMORY_ITEMS) || 5000;
  }

  async onModuleInit() {
    this.ensureDataDirectory();
    await this.restoreFromDisk();
  }

  private ensureDataDirectory(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      this.logger.warn(`Échec de création du dossier de données ${this.dataDir} : ${err}`);
    }
  }

  private setFilePermissions(filePath: string): void {
    if (process.platform === 'win32') return;
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o600);
      }
    } catch {
      // Ignorer sur Windows ou environnements restreints
    }
  }

  /**
   * Relecture des fichiers au démarrage pour reconstruire l'état mémoire.
   * Une ligne corrompue est ignorée et loguée sans bloquer le serveur.
   */
  async restoreFromDisk(): Promise<void> {
    if (!fs.existsSync(this.alertsFilePath)) return;

    try {
      const fileStream = fs.createReadStream(this.alertsFilePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const record = JSON.parse(trimmed) as Alert;
          if (record && record.id && record.type && record.category) {
            this.memoryAlerts.set(record.id, record);
          } else {
            this.logger.warn(`Ligne JSONL invalide ignorée dans ${this.alertsFilePath}`);
          }
        } catch (parseErr) {
          this.logger.warn(
            `Ligne corrompue ignorée dans ${this.alertsFilePath} : ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
        }
      }

      this.enforceMemoryLimit();
      this.logger.log(
        `Historique des alertes restauré avec succès (${this.memoryAlerts.size} alertes en mémoire)`,
      );
    } catch (err) {
      this.logger.warn(
        `Erreur lors de la relecture de ${this.alertsFilePath} : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private enforceMemoryLimit(): void {
    if (this.memoryAlerts.size <= this.maxMemoryItems) return;
    const sorted = Array.from(this.memoryAlerts.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const toRemove = sorted.slice(0, this.memoryAlerts.size - this.maxMemoryItems);
    for (const item of toRemove) {
      this.memoryAlerts.delete(item.id);
    }
  }

  private enqueueWrite(filePath: string, record: unknown): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(async () => {
        try {
          this.ensureDataDirectory();
          const line = JSON.stringify(record) + '\n';
          await fs.promises.appendFile(filePath, line, { encoding: 'utf-8', mode: 0o600 });
          this.setFilePermissions(filePath);
        } catch (err) {
          this.logger.warn(
            `Échec d'écriture disque (${filePath}) : ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })
      .catch((err) => {
        this.logger.warn(`Erreur inattendue file d'attente d'écriture : ${err}`);
      });

    return this.writeQueue;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async create(data: CreateAlertData): Promise<Alert> {
    const now = new Date().toISOString();
    const alert: Alert = {
      id: `alt-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type: data.type,
      category: data.category,
      status: data.status || AlertStatus.NEW,
      message: data.message,
      trackId: data.trackId || null,
      cameraIds: data.cameraIds || [],
      cameraState: data.cameraState || null,
      confidence: data.confidence ?? null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.memoryAlerts.set(alert.id, alert);
    this.enforceMemoryLimit();
    void this.enqueueWrite(this.alertsFilePath, alert);

    return alert;
  }

  async update(id: string, data: UpdateAlertData): Promise<Alert | null> {
    const existing = this.memoryAlerts.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: Alert = {
      ...existing,
      type: data.type !== undefined ? data.type : existing.type,
      category: data.category !== undefined ? data.category : existing.category,
      status: data.status !== undefined ? data.status : existing.status,
      message: data.message !== undefined ? data.message : existing.message,
      confidence: data.confidence !== undefined ? data.confidence : existing.confidence,
      cameraIds: data.cameraIds !== undefined ? data.cameraIds : existing.cameraIds,
      acknowledgedAt: data.acknowledgedAt !== undefined ? data.acknowledgedAt : existing.acknowledgedAt,
      acknowledgedBy: data.acknowledgedBy !== undefined ? data.acknowledgedBy : existing.acknowledgedBy,
      resolvedAt: data.resolvedAt !== undefined ? data.resolvedAt : existing.resolvedAt,
      updatedAt: now,
    };

    this.memoryAlerts.set(id, updated);
    void this.enqueueWrite(this.alertsFilePath, updated);

    return updated;
  }

  async findUnique(id: string): Promise<Alert | null> {
    return this.memoryAlerts.get(id) || null;
  }

  async findMany(options: ListAlertsOptions = {}): Promise<Alert[]> {
    let list = Array.from(this.memoryAlerts.values());

    if (options.status) {
      list = list.filter((a) => a.status === options.status);
    }

    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    if (options.before) {
      const index = list.findIndex((a) => a.id === options.before);
      if (index !== -1) {
        list = list.slice(index + 1);
      }
    }

    const limit = options.limit ? Math.min(Math.max(options.limit, 1), 200) : 50;
    return list.slice(0, limit);
  }

  /**
   * Purge atomique des alertes plus anciennes que `days` jours.
   * Écrit dans un fichier temporaire puis effectue un rename atomique.
   */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const tmpFilePath = `${this.alertsFilePath}.tmp`;
    let purgedCount = 0;

    try {
      this.ensureDataDirectory();
      const validAlerts: Alert[] = [];

      // Conserver les alertes valides
      for (const alert of this.memoryAlerts.values()) {
        const createdTime = new Date(alert.createdAt).getTime();
        if (createdTime >= cutoffMs) {
          validAlerts.push(alert);
        } else {
          purgedCount++;
        }
      }

      // Écriture atomique dans .tmp
      const tmpStream = fs.createWriteStream(tmpFilePath, { encoding: 'utf-8', mode: 0o600 });
      for (const alert of validAlerts) {
        tmpStream.write(JSON.stringify(alert) + '\n');
      }
      await new Promise<void>((resolve, reject) => {
        tmpStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });

      // Rename atomique
      if (fs.existsSync(tmpFilePath)) {
        await fs.promises.rename(tmpFilePath, this.alertsFilePath);
        this.setFilePermissions(this.alertsFilePath);
      }

      // Nettoyage de la mémoire
      for (const [id, alert] of Array.from(this.memoryAlerts.entries())) {
        if (new Date(alert.createdAt).getTime() < cutoffMs) {
          this.memoryAlerts.delete(id);
        }
      }

      this.logger.log(`Purge atomique JSONL réalisée avec succès (${purgedCount} alertes supprimées)`);
      return purgedCount;
    } catch (err) {
      this.logger.warn(
        `Échec de la purge atomique des alertes : ${err instanceof Error ? err.message : String(err)}`,
      );
      if (fs.existsSync(tmpFilePath)) {
        try {
          await fs.promises.unlink(tmpFilePath);
        } catch {
          // Ignorer
        }
      }
      return 0;
    }
  }

  async createStateLog(
    data: Omit<CameraStateLog, 'id' | 'createdAt'>,
  ): Promise<CameraStateLog> {
    const log: CameraStateLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      cameraId: data.cameraId,
      state: data.state,
      previousState: data.previousState || null,
      reason: data.reason,
      lumMean: data.lumMean ?? null,
      lumStddev: data.lumStddev ?? null,
      exposureUs: data.exposureUs ?? null,
      gainDb: data.gainDb ?? null,
      createdAt: new Date().toISOString(),
    };

    void this.enqueueWrite(this.cameraLogsFilePath, log);
    return log;
  }
}
