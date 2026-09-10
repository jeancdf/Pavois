import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { headingDeltaDeg, wrapHeadingDeg } from './udp-attitude';

/** Pose d'une caméra, diffusée au frontend par l'événement `camera_positions`. */
export interface CameraConfig {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
  fovDeg: number;
}

export type CameraPosition = Pick<CameraConfig, 'lat' | 'lon' | 'alt'>;

const ATTITUDE_MIN_DELTA_DEG = 0.4;

// Caméras des trois Pi (le script d'installation donne à camera.0.id le nom de la Pi).
// Positions provisoires reprises du dernier site de pavois++/pavois++.conf, à placer
// depuis le frontend. FOV de pavois++/deploy/pavois.conf.example (OV5647).
const DEFAULT_CAMERAS: CameraConfig[] = [
  { id: 'jean', lat: 48.826132, lon: 2.365856, alt: 58.524, headingDeg: 164, fovDeg: 65 },
  { id: 'tanel', lat: 48.826134, lon: 2.365869, alt: 58.524, headingDeg: 164, fovDeg: 65 },
  { id: 'walid', lat: 48.826098, lon: 2.365877, alt: 58.524, headingDeg: 344, fovDeg: 65 },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isCameraPosition(value: unknown): value is CameraPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lon, alt } = value as Record<string, unknown>;
  return (
    isFiniteNumber(lat) &&
    Math.abs(lat) <= 90 &&
    isFiniteNumber(lon) &&
    Math.abs(lon) <= 180 &&
    isFiniteNumber(alt)
  );
}

function isCameraConfig(value: unknown): value is CameraConfig {
  if (!isCameraPosition(value)) return false;
  const { id, headingDeg, fovDeg } = value as Partial<CameraConfig>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isFiniteNumber(headingDeg) &&
    isFiniteNumber(fovDeg)
  );
}

@Injectable()
export class CamerasService {
  private readonly filePath = path.resolve(
    process.env.CAMERAS_FILE || 'data/cameras.json',
  );
  private cameras = this.load();
  private readonly imuSeen = new Set<string>();

  list(): CameraConfig[] {
    return this.cameras;
  }

  updatePosition(id: string, position: CameraPosition): CameraConfig {
    const current = this.cameras.find((camera) => camera.id === id);
    if (!current) {
      throw new NotFoundException(`Caméra inconnue : ${id}`);
    }

    const updated = { ...current, lat: position.lat, lon: position.lon, alt: position.alt };
    const cameras = this.cameras.map((camera) => (camera.id === id ? updated : camera));
    this.save(cameras);
    this.cameras = cameras;
    return updated;
  }

  /**
   * Heading from the Pi IMU. Kept in memory so GPS edits on disk stay
   * intact; the next att packet after restart restores the live cap.
   */
  updateAttitude(id: string, headingDeg: number): CameraConfig | null {
    const current = this.cameras.find((camera) => camera.id === id);
    if (!current) return null;

    const heading = wrapHeadingDeg(headingDeg);
    const first = !this.imuSeen.has(id);
    const delta = headingDeltaDeg(current.headingDeg, heading);
    if (!first && delta < ATTITUDE_MIN_DELTA_DEG) return null;

    this.imuSeen.add(id);
    const updated = { ...current, headingDeg: heading };
    this.cameras = this.cameras.map((camera) =>
      camera.id === id ? updated : camera,
    );
    return updated;
  }

  // Un fichier illisible bloque le démarrage : repartir des valeurs par défaut
  // écraserait les positions enregistrées au prochain déplacement.
  private load(): CameraConfig[] {
    if (!fs.existsSync(this.filePath)) {
      return DEFAULT_CAMERAS;
    }

    let cameras: unknown;
    try {
      cameras = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Configuration caméras illisible (${this.filePath}) : ${String(error)}`);
    }
    if (!Array.isArray(cameras) || !cameras.every(isCameraConfig)) {
      throw new Error(`Configuration caméras invalide (${this.filePath})`);
    }
    return cameras;
  }

  // Fichier temporaire puis renommage : jamais de fichier à moitié écrit.
  private save(cameras: CameraConfig[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cameras, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }
}
