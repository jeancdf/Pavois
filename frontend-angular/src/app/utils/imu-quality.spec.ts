import { ImuSample } from '../models/imu-sample.model';
import {
  IMU_QUALITY_LABELS,
  IMU_STALE_MS,
  formatCalibration,
  imuQuality,
} from './imu-quality';

const NOW = 1_000_000;

function sample(overrides: Partial<ImuSample> = {}): ImuSample {
  return {
    cameraId: 'jean',
    headingDeg: 164.2,
    elevationDeg: -1.5,
    rollDeg: 0.3,
    calibration: { sys: 3, gyro: 3, accel: 3, mag: 3 },
    valid: true,
    timestamp: NOW,
    receivedAt: NOW,
    ...overrides,
  };
}

describe('imuQuality', () => {
  it('trusts a fresh, valid, fully calibrated heading', () => {
    expect(imuQuality(sample(), NOW)).toBe('ok');
  });

  it('flags a partial calibration when sys or mag is below 2', () => {
    expect(imuQuality(sample({ calibration: { sys: 3, gyro: 3, accel: 3, mag: 1 } }), NOW))
      .toBe('partielle');
    expect(imuQuality(sample({ calibration: { sys: 1, gyro: 3, accel: 3, mag: 3 } }), NOW))
      .toBe('partielle');
  });

  it('does not downgrade on gyro or accel alone', () => {
    expect(imuQuality(sample({ calibration: { sys: 2, gyro: 0, accel: 0, mag: 2 } }), NOW))
      .toBe('ok');
  });

  it('reports unknown calibration when the Pi does not send it', () => {
    expect(imuQuality(sample({ calibration: null }), NOW)).toBe('inconnue');
    expect(imuQuality(sample({ calibration: { sys: null, gyro: 3, accel: 3, mag: null } }), NOW))
      .toBe('inconnue');
  });

  it('judges a BNO08x on its magnetometer alone', () => {
    const magOnly = (mag: number) => ({ sys: null, gyro: null, accel: null, mag });
    expect(imuQuality(sample({ calibration: magOnly(3) }), NOW)).toBe('ok');
    expect(imuQuality(sample({ calibration: magOnly(1) }), NOW)).toBe('partielle');
  });

  it('reports a frozen heading before looking at calibration', () => {
    expect(imuQuality(sample({ valid: false, calibration: null }), NOW)).toBe('figee');
  });

  it('reports a silent Pi before anything else', () => {
    const stale = sample({ valid: false, receivedAt: NOW - IMU_STALE_MS - 1 });
    expect(imuQuality(stale, NOW)).toBe('silencieuse');
    expect(imuQuality(sample({ receivedAt: NOW - IMU_STALE_MS }), NOW)).toBe('ok');
  });

  it('has a label for every state', () => {
    expect(Object.keys(IMU_QUALITY_LABELS).sort()).toEqual(
      ['figee', 'inconnue', 'ok', 'partielle', 'silencieuse'],
    );
  });
});

describe('formatCalibration', () => {
  it('formats the four levels', () => {
    expect(formatCalibration({ sys: 3, gyro: 0, accel: 1, mag: 3 })).toBe('S3 G0 A1 M3');
  });

  it('shows a dash when unknown', () => {
    expect(formatCalibration(null)).toBe('—');
    expect(formatCalibration({ sys: null, gyro: null, accel: null, mag: 3 })).toBe('S- G- A- M3');
  });
});
