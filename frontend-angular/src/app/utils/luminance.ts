/** Luminosité de l'image d'une caméra, lue dans ses lignes stats,v2. */

import { CameraStats } from '../models/camera-stats.model';

export type LuminanceLevel = 'sombre' | 'correcte' | 'claire';

/** Les stats arrivent chaque seconde : au-delà, la valeur n'est plus actuelle. */
export const LUMINANCE_STALE_MS = 4000;

/** Plage à viser pour la détection, sur 0–255. */
export const LUMINANCE_TARGET_MIN = 90;
export const LUMINANCE_TARGET_MAX = 150;

/** En dehors, le contraste se perd : ombres bouchées ou ciel brûlé. */
export const LUMINANCE_DARK_MAX = 70;
export const LUMINANCE_BRIGHT_MIN = 180;

export const LUMINANCE_LABELS: Record<LuminanceLevel, string> = {
  sombre: 'trop sombre',
  correcte: 'correcte',
  claire: 'trop claire',
};

export interface LuminanceReading {
  value: number;
  level: LuminanceLevel;
  label: string;
  /** Position sur une jauge de 0 à 100. */
  percent: number;
}

export function luminanceLevel(lumMean: number): LuminanceLevel {
  if (lumMean < LUMINANCE_DARK_MAX) return 'sombre';
  if (lumMean > LUMINANCE_BRIGHT_MIN) return 'claire';
  return 'correcte';
}

/** null sans stats récentes ou sans luminosité (détecteur ancien, trame v1). */
export function luminanceReading(
  stats: CameraStats | undefined,
  now: number,
): LuminanceReading | null {
  if (!stats || now - stats.receivedAt > LUMINANCE_STALE_MS) return null;
  const lum = stats.lumMean;
  if (typeof lum !== 'number' || !Number.isFinite(lum)) return null;
  const value = Math.round(Math.min(255, Math.max(0, lum)));
  const level = luminanceLevel(value);
  return {
    value,
    level,
    label: LUMINANCE_LABELS[level],
    percent: (value / 255) * 100,
  };
}

/**
 * Temps de pose et gain que la caméra a utilisés pour ses dernières images,
 * ou null quand le Pi ne les connaît pas (rejeu) ou ne parle plus.
 */
export function formatExposure(stats: CameraStats | undefined, now: number): string | null {
  if (!stats?.exposureUs || now - stats.receivedAt > LUMINANCE_STALE_MS) return null;
  const gain = Math.pow(10, (stats.gainDb ?? 0) / 20);
  return `${Math.round(stats.exposureUs)} µs ×${gain.toFixed(1)}`;
}
