/** Confiance à accorder au cap IMU d'une Pi, du meilleur au pire. */

import { ImuCalibration, ImuSample } from '../models/imu-sample.model';

export type ImuQuality = 'ok' | 'partielle' | 'inconnue' | 'figee' | 'silencieuse';

/** Au-delà, la Pi est considérée muette. */
export const IMU_STALE_MS = 2000;

/** Niveau minimal (sys et mag, s'ils sont connus) pour faire confiance au cap. */
export const IMU_MIN_TRUSTED_LEVEL = 2;

export const IMU_QUALITY_LABELS: Record<ImuQuality, string> = {
  ok: 'calibrée',
  partielle: 'calibration partielle',
  inconnue: 'calibration inconnue',
  figee: 'cap figé',
  silencieuse: 'silencieuse',
};

export function imuQuality(sample: ImuSample, now: number): ImuQuality {
  if (now - sample.receivedAt > IMU_STALE_MS) return 'silencieuse';
  if (!sample.valid) return 'figee';
  // Le BNO08x ne remonte que le magnétomètre : sys reste inconnu.
  const sys = sample.calibration?.sys ?? null;
  const mag = sample.calibration?.mag ?? null;
  if (sys === null && mag === null) return 'inconnue';
  if (
    (sys !== null && sys < IMU_MIN_TRUSTED_LEVEL) ||
    (mag !== null && mag < IMU_MIN_TRUSTED_LEVEL)
  ) {
    return 'partielle';
  }
  return 'ok';
}

export function formatCalibration(calibration: ImuCalibration | null): string {
  if (!calibration) return '—';
  const level = (value: number | null) => (value === null ? '-' : value);
  return `S${level(calibration.sys)} G${level(calibration.gyro)} A${level(calibration.accel)} M${level(calibration.mag)}`;
}
