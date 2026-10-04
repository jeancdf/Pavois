import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { headingDeltaDeg, wrapHeadingDeg } from './udp/udp-attitude';
import {
  buildRailBenchState,
  localPoseOf,
  type RailBenchOptions,
  type RailBenchState,
  type RailLocalPose,
} from './rail-bench';

/** Pose d'une caméra, diffusée au frontend par l'événement `camera_positions`. */
export interface CameraConfig {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  headingDeg: number;
  fovDeg: number;
  rangeM: number;
  localX?: number;
  localY?: number;
  localZ?: number;
  localHeadingDeg?: number;
  localElevationDeg?: number;
  localRollDeg?: number;
  railX?: number;
  railY?: number;
  railZ?: number;
  railHeadingDeg?: number;
  railElevationDeg?: number;
  railRollDeg?: number;
}

export type CameraPosition = Pick<CameraConfig, 'lat' | 'lon' | 'alt'>;

const ATTITUDE_MIN_DELTA_DEG = 0.4;

// Portée par défaut d'une caméra (m), utilisée pour dessiner le cône de champ
// de vision. Avant ce champ, le frontend calculait une "portée" en prenant la
// distance entre les deux premières caméras du parc (~1m entre elles) — les
// cônes étaient donc invisibles à toute échelle utile.
//
// 60m reprend fusion_max_range_m=60 (pavois++.conf, plafond de sécurité déjà
// utilisé par le pipeline de fusion réel) plutôt que le max_range_m=30 de
// PLAN.md, qui n'est qu'un schéma Django illustratif, pas une mesure.
//
// Vérification optique (config réelle déployée sur walid le 11/09/2026 :
// FOV 65°, largeur traitée 1280px, min_blob_area=12px² dans pavois++.conf) :
// résolution angulaire ≈ 65/1280 = 0.0508°/px, taille min détectable
// ≈ √12 px ≈ 3.46px → angle min ≈ 0.00307 rad. Portée théorique au seuil
// minimum (bruité, pas confirmé sur plusieurs frames) : ~98m pour un drone de
// 0.3m, ~163m pour 0.5m. 60m reste donc un plafond conservateur par rapport à
// cette limite optique, pas une vraie portée mesurée sur le terrain — à
// affiner avec un test réel.
const DEFAULT_RANGE_M = 60;

// Caméras des trois Pi (le script d'installation donne à camera.0.id le nom de la Pi).
// Positions provisoires reprises du dernier site de pavois++/pavois++.conf, à placer
// depuis le frontend. FOV de pavois++/deploy/pavois.conf.example (OV5647).
const DEFAULT_CAMERAS: CameraConfig[] = [
  {
    id: 'jean',
    lat: 48.826132,
    lon: 2.365856,
    alt: 58.524,
    headingDeg: 164,
    fovDeg: 65,
    rangeM: DEFAULT_RANGE_M,
  },
  {
    id: 'tanel',
    lat: 48.826134,
    lon: 2.365869,
    alt: 58.524,
    headingDeg: 164,
    fovDeg: 65,
    rangeM: DEFAULT_RANGE_M,
  },
  {
    id: 'walid',
    lat: 48.826098,
    lon: 2.365877,
    alt: 58.524,
    headingDeg: 344,
    fovDeg: 65,
    rangeM: DEFAULT_RANGE_M,
  },
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
  const { id, headingDeg, fovDeg, rangeM } = value as Partial<CameraConfig>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isFiniteNumber(headingDeg) &&
    isFiniteNumber(fovDeg) &&
    // rangeM est optionnel à la lecture : un data/cameras.json écrit avant
    // l'ajout de ce champ ne doit pas empêcher le backend de démarrer, voir
    // le backfill dans load().
    (rangeM === undefined || (isFiniteNumber(rangeM) && rangeM > 0))
  );
}

@Injectable()
export class CamerasService {
  private readonly filePath = path.resolve(
    process.env.CAMERAS_FILE || 'data/cameras.json',
  );
  private cameras = this.load();
  private readonly imuSeen = new Set<string>();
  private railBench: RailBenchState | null = null;

  list(): CameraConfig[] {
    return this.cameras.map((camera) => this.withLocalPose(camera));
  }

  railBenchState(): RailBenchState | null {
    return this.railBench;
  }

  isRailBenchActive(): boolean {
    return this.railBench !== null;
  }

  localPose(cameraId: string): RailLocalPose | null {
    return localPoseOf(this.railBench, cameraId);
  }

  applyRailBench(options: RailBenchOptions = {}): RailBenchState {
    this.railBench = this.buildCalibratedRailBench(options);
    return this.railBench;
  }

  clearRailBench(): void {
    this.railBench = null;
  }

  /** Persist a pose measured by the Pi's ChArUco field tool. */
  updateRailCalibration(cameraId: string, pose: RailLocalPose): boolean {
    const current = this.cameras.find((camera) => camera.id === cameraId);
    if (!current) return false;
    const nextValues = [
      pose.x,
      pose.y,
      pose.z,
      pose.headingDeg,
      pose.elevationDeg,
      pose.rollDeg,
    ];
    if (!nextValues.every(Number.isFinite)) return false;
    const previousValues = [
      current.railX,
      current.railY,
      current.railZ,
      current.railHeadingDeg,
      current.railElevationDeg,
      current.railRollDeg,
    ];
    const unchanged = previousValues.every(
      (value, index) =>
        typeof value === 'number' && Math.abs(value - nextValues[index]) < 1e-4,
    );
    if (unchanged) return false;

    const updated: CameraConfig = {
      ...current,
      railX: pose.x,
      railY: pose.y,
      railZ: pose.z,
      railHeadingDeg: wrapHeadingDeg(pose.headingDeg),
      railElevationDeg: pose.elevationDeg,
      railRollDeg: pose.rollDeg,
    };
    this.cameras = this.cameras.map((camera) =>
      camera.id === cameraId ? updated : camera,
    );
    this.save(this.cameras);

    if (this.railBench) {
      const currentBench = this.railBench;
      this.railBench = this.buildCalibratedRailBench({
        rigWidthMm: currentBench.rigWidthMm,
        rangeM: currentBench.rangeM,
        targetSizeM: currentBench.targetSizeM,
        hoverM: currentBench.hoverM,
        headingDeg: currentBench.headingDeg,
        elevationDeg: currentBench.elevationDeg,
      });
    }
    return true;
  }

  private buildCalibratedRailBench(options: RailBenchOptions): RailBenchState {
    const bench = buildRailBenchState(options);
    return {
      ...bench,
      cameras: bench.cameras.map((fallback) => {
        const camera = this.cameras.find((item) => item.id === fallback.id);
        const values = camera
          ? [
              camera.railX,
              camera.railY,
              camera.railZ,
              camera.railHeadingDeg,
              camera.railElevationDeg,
              camera.railRollDeg,
            ]
          : [];
        if (
          values.length !== 6 ||
          !values.every(
            (value) => typeof value === 'number' && Number.isFinite(value),
          )
        ) {
          return fallback;
        }
        return {
          id: fallback.id,
          x: camera!.railX!,
          y: camera!.railY!,
          z: camera!.railZ!,
          headingDeg: camera!.railHeadingDeg!,
          elevationDeg: camera!.railElevationDeg!,
          rollDeg: camera!.railRollDeg!,
        };
      }),
    };
  }

  private withLocalPose(camera: CameraConfig): CameraConfig {
    const local = this.localPose(camera.id);
    if (!local) {
      return { ...camera };
    }
    return {
      ...camera,
      localX: local.x,
      localY: local.y,
      localZ: local.z,
      localHeadingDeg: local.headingDeg,
      localElevationDeg: local.elevationDeg,
      localRollDeg: local.rollDeg,
    };
  }

  updatePosition(id: string, position: CameraPosition): CameraConfig {
    const current = this.cameras.find((camera) => camera.id === id);
    if (!current) {
      throw new NotFoundException(`Caméra inconnue : ${id}`);
    }

    const updated = {
      ...current,
      lat: position.lat,
      lon: position.lon,
      alt: position.alt,
    };
    const cameras = this.cameras.map((camera) =>
      camera.id === id ? updated : camera,
    );
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
      throw new Error(
        `Configuration caméras illisible (${this.filePath}) : ${String(error)}`,
      );
    }
    if (!Array.isArray(cameras) || !cameras.every(isCameraConfig)) {
      throw new Error(`Configuration caméras invalide (${this.filePath})`);
    }
    // Backfill pour un fichier écrit avant l'ajout de rangeM.
    return cameras.map((camera) => ({
      ...camera,
      rangeM:
        isFiniteNumber(camera.rangeM) && camera.rangeM > 0
          ? camera.rangeM
          : DEFAULT_RANGE_M,
    }));
  }

  // Fichier temporaire puis renommage : jamais de fichier à moitié écrit.
  private save(cameras: CameraConfig[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cameras, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }
}
