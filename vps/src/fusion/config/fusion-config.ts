import {
  DEFAULT_TRACKER_CONFIG,
  type TrackerConfig,
} from '../tracking/fusion-tracker';
import {
  DEFAULT_TRIANGULATION_CONFIG,
  type TriangulationConfig,
} from '../triangulation/fusion-triangulate';

/** Réglages qu'un opérateur peut changer pendant que le moteur tourne. */
export interface FusionTuning {
  maxResidualPx: number;
  minParallaxDeg: number;
  minRangeM: number;
  maxRangeM: number;
  assocGatePx: number;
  pairGatePx: number;
  maxBlobsPerCamera: number;
  maxTargets: number;
  intervalMs: number;
  latencyMs: number;
  confirmUpdates: number;
  maxCoastMs: number;
  gateChi2: number;
  matchDistanceM: number;
  maxSpeedMps: number;
  processNoise: number;
}

/**
 * Lit un entier positif dans l'environnement, sinon la valeur par défaut.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

/**
 * Lit un nombre positif dans l'environnement, sinon la valeur par défaut.
 */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

/** Lit les réglages du suivi de pistes dans l'environnement. */
export function trackerConfigFromEnv(): TrackerConfig {
  return {
    matchDistanceM: envNumber('FUSION_TRACK_MATCH_M', 6),
    processNoise: envNumber('FUSION_TRACK_PROCESS_NOISE', 200),
    measNoise: envNumber('FUSION_TRACK_MEAS_NOISE', 2.5),
    confirmUpdates: envInt('FUSION_TRACK_CONFIRM', 3),
    maxCoastMs: envInt('FUSION_TRACK_MAX_COAST_MS', 1200),
    maxSpeedMps: envNumber('FUSION_TRACK_MAX_SPEED_MPS', 120),
    gateChi2: envNumber(
      'FUSION_TRACK_GATE_CHI2',
      DEFAULT_TRACKER_CONFIG.gateChi2,
    ),
    measFloorM: envNumber(
      'FUSION_TRACK_MEAS_FLOOR_M',
      DEFAULT_TRACKER_CONFIG.measFloorM,
    ),
  };
}

/** Lit les réglages de la triangulation dans l'environnement. */
export function triangulationConfigFromEnv(): TriangulationConfig {
  const d = DEFAULT_TRIANGULATION_CONFIG;
  return {
    minParallaxDeg: envNumber('FUSION_MIN_PARALLAX_DEG', d.minParallaxDeg),
    maxResidualPx: envNumber('FUSION_MAX_RESIDUAL_PX', d.maxResidualPx),
    maxResidualM: envNumber('FUSION_MAX_RESIDUAL_M', d.maxResidualM),
    maxRangeM: envNumber('FUSION_MAX_RANGE_M', d.maxRangeM),
    minRangeM: envNumber('FUSION_MIN_RANGE_M', d.minRangeM),
    pixelSigma: envNumber('FUSION_PIXEL_SIGMA', d.pixelSigma),
    poseSigmaDeg: envNumber('FUSION_POSE_SIGMA_DEG', d.poseSigmaDeg),
  };
}
