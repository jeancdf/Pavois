import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Track } from '../track-types';
import {
  CreateTrackData,
  ListTracksOptions,
  TrackStore,
  UpdateTrackVerdictData,
} from './track-store.interface';

@Injectable()
export class JsonlTrackStore implements TrackStore, OnModuleInit {
  private readonly logger = new Logger(JsonlTrackStore.name);
  private readonly dataDir: string;
  private readonly tracksFilePath: string;
  private readonly memoryTracks = new Map<string, Track>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.dataDir = path.resolve(process.env.ALERTS_DATA_DIR || './data');
    this.tracksFilePath = path.join(this.dataDir, 'tracks.jsonl');
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
      // Ignorer
    }
  }

  async restoreFromDisk(): Promise<void> {
    if (!fs.existsSync(this.tracksFilePath)) return;

    try {
      const fileStream = fs.createReadStream(this.tracksFilePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const record = JSON.parse(trimmed) as Track;
          if (record && record.id && record.trackId) {
            this.memoryTracks.set(record.id, record);
          }
        } catch {
          // Ligne corrompue ignorée
        }
      }
    } catch (err) {
      this.logger.warn(`Erreur lors de la relecture des pistes : ${err}`);
    }
  }

  private enqueueWrite(record: unknown): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(async () => {
        try {
          this.ensureDataDirectory();
          const line = JSON.stringify(record) + '\n';
          await fs.promises.appendFile(this.tracksFilePath, line, { encoding: 'utf-8', mode: 0o600 });
          this.setFilePermissions(this.tracksFilePath);
        } catch (err) {
          this.logger.warn(`Échec d'écriture piste disque : ${err}`);
        }
      })
      .catch((err) => {
        this.logger.warn(`Erreur file d'attente d'écriture piste : ${err}`);
      });

    return this.writeQueue;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async create(data: CreateTrackData): Promise<Track> {
    const track: Track = {
      id: `trk-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      trackId: data.trackId,
      lat: data.lat,
      lng: data.lng,
      alt: data.alt,
      classification: data.classification || null,
      timestampUs: data.timestampUs,
      receivedAt: new Date().toISOString(),
      verdict: null,
      verdictNote: null,
      verdictBy: null,
      verdictAt: null,
    };

    this.memoryTracks.set(track.id, track);
    void this.enqueueWrite(track);

    return track;
  }

  async findMany(options: ListTracksOptions = {}): Promise<Track[]> {
    const limit = options.limit ? Math.min(Math.max(options.limit, 1), 1000) : 100;
    const list = Array.from(this.memoryTracks.values()).sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
    return list.slice(0, limit);
  }

  async findUnique(id: string): Promise<Track | null> {
    return this.memoryTracks.get(id) || null;
  }

  async updateVerdict(id: string, data: UpdateTrackVerdictData): Promise<Track | null> {
    const existing = this.memoryTracks.get(id);
    if (!existing) return null;

    const updated: Track = {
      ...existing,
      verdict: data.verdict,
      verdictNote: data.verdictNote || existing.verdictNote,
      verdictBy: data.verdictBy || existing.verdictBy,
      verdictAt: new Date().toISOString(),
    };

    this.memoryTracks.set(id, updated);
    void this.enqueueWrite(updated);

    return updated;
  }
}
