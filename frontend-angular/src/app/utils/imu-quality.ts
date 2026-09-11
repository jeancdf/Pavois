/** Confiance à accorder au cap IMU d'une Pi, du meilleur au pire. */

import { ImuCalibration, ImuSample } from '../models/imu-sample.model';

export type ImuQuality = 'ok' | 'partielle' | 'inconnue' | 'figee' | 'silencieuse';

/** Au-delà, la Pi est considérée muette. */
export const IMU_STALE_MS = 2000;

/** Niveau BNO055 minimal (sys et mag) pour faire confiance au cap absolu. */
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
  const calibration = sample.calibration;
  if (!calibration) return 'inconnue';
  if (
    calibration.sys < IMU_MIN_TRUSTED_LEVEL ||
    calibration.mag < IMU_MIN_TRUSTED_LEVEL
  ) {
    return 'partielle';
  }
  return 'ok';
}

export function formatCalibration(calibration: ImuCalibration | null): string {
  if (!calibration) return '—';
  return `S${calibration.sys} G${calibration.gyro} A${calibration.accel} M${calibration.mag}`;
}
