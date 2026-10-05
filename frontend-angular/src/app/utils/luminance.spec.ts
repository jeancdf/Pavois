import { CameraStats } from '../models/camera-stats.model';
import { LUMINANCE_STALE_MS, formatExposure, luminanceLevel, luminanceReading } from './luminance';

const NOW = 1_000_000;

function stats(overrides: Partial<CameraStats> = {}): CameraStats {
  return {
    type: 'camera_stats',
    cameraId: 'jean',
    fps: 29.8,
    frameIndex: 1042,
    timestamp: NOW,
    lumMean: 112.4,
    lumStddev: 38.2,
    exposureUs: 300,
    gainDb: 0,
    receivedAt: NOW,
    ...overrides,
  };
}

describe('luminanceLevel', () => {
  it('flags a dark, a correct and a bright image', () => {
    expect(luminanceLevel(40)).toBe('sombre');
    expect(luminanceLevel(120)).toBe('correcte');
    expect(luminanceLevel(230)).toBe('claire');
  });
});

describe('luminanceReading', () => {
  it('rounds the mean and places it on the 0–255 gauge', () => {
    const reading = luminanceReading(stats(), NOW);
    expect(reading).toEqual({
      value: 112,
      level: 'correcte',
      label: 'correcte',
      percent: (112 / 255) * 100,
    });
  });

  it('is null without luminance (detector sending stats v1)', () => {
    expect(luminanceReading(stats({ lumMean: undefined }), NOW)).toBeNull();
  });

  it('is null once the camera stops sending stats', () => {
    expect(luminanceReading(stats(), NOW + LUMINANCE_STALE_MS + 1)).toBeNull();
    expect(luminanceReading(undefined, NOW)).toBeNull();
  });
});

describe('formatExposure', () => {
  it('shows shutter time and linear gain', () => {
    expect(formatExposure(stats({ exposureUs: 750, gainDb: 20 * Math.log10(4) }), NOW)).toBe(
      '750 µs ×4.0',
    );
  });

  it('is null when the Pi cannot tell its exposure', () => {
    expect(formatExposure(stats({ exposureUs: 0 }), NOW)).toBeNull();
  });
});
