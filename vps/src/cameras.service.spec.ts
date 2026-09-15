import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CamerasService } from './cameras.service';
import type { CameraConfig } from './cameras.service';

describe('CamerasService.updateAttitude', () => {
  const originalCamerasFile = process.env.CAMERAS_FILE;
  let service: CamerasService;

  beforeEach(() => {
    process.env.CAMERAS_FILE = join(tmpdir(), 'pavois-no-cameras.json');
    service = new CamerasService();
  });

  afterEach(() => {
    if (originalCamerasFile === undefined) {
      delete process.env.CAMERAS_FILE;
    } else {
      process.env.CAMERAS_FILE = originalCamerasFile;
    }
  });

  function camera(id: string): CameraConfig | undefined {
    return service.list().find((item) => item.id === id);
  }

  it('applies the first packet even when delta is under 0.4 deg', () => {
    expect(camera('jean')?.headingDeg).toBe(164);
    expect(camera('tanel')?.headingDeg).toBe(164);
    expect(camera('walid')?.headingDeg).toBe(344);

    const updated = service.updateAttitude('jean', 164.1);
    expect(updated).not.toBeNull();
    expect(updated?.id).toBe('jean');
    expect(updated?.headingDeg).toBeCloseTo(164.1);
    expect(camera('jean')?.headingDeg).toBeCloseTo(164.1);
    expect(camera('tanel')?.headingDeg).toBe(164);
    expect(camera('walid')?.headingDeg).toBe(344);
  });

  it('ignores a second packet whose heading delta is under 0.4 deg', () => {
    const first = service.updateAttitude('jean', 164.1);
    expect(first).not.toBeNull();
    expect(service.updateAttitude('jean', 164.2)).toBeNull();
    expect(camera('jean')?.headingDeg).toBeCloseTo(164.1);
  });

  it('applies a second packet when heading delta is >= 0.4 deg', () => {
    expect(service.updateAttitude('jean', 164.1)).not.toBeNull();
    const updated = service.updateAttitude('jean', 164.6);
    expect(updated).not.toBeNull();
    expect(updated?.headingDeg).toBeCloseTo(164.6);
    expect(camera('jean')?.headingDeg).toBeCloseTo(164.6);
  });

  it('returns null for an unknown camera id and leaves jean unchanged', () => {
    expect(camera('jean')?.headingDeg).toBe(164);
    expect(service.updateAttitude('ghost', 170)).toBeNull();
    expect(camera('jean')?.headingDeg).toBe(164);
  });

  it('applies a heading that wraps through 0 degrees', () => {
    const first = service.updateAttitude('jean', 359.5);
    expect(first).not.toBeNull();
    expect(first?.headingDeg).toBeCloseTo(359.5);

    const updated = service.updateAttitude('jean', 0);
    expect(updated).not.toBeNull();
    expect(updated?.headingDeg).toBe(0);
    expect(camera('jean')?.headingDeg).toBe(0);
  });

  it('does not persist cameras.json when attitude is updated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pavois-cameras-'));
    const filePath = join(dir, 'cameras.json');
    const cameras: CameraConfig[] = [
      {
        id: 'jean',
        lat: 48.8,
        lon: 2.3,
        alt: 50,
        headingDeg: 10,
        fovDeg: 65,
        rangeM: 60,
      },
    ];
    const original = JSON.stringify(cameras, null, 2);
    writeFileSync(filePath, original);
    process.env.CAMERAS_FILE = filePath;

    const isolated = new CamerasService();
    const updated = isolated.updateAttitude('jean', 20);
    expect(updated).not.toBeNull();
    expect(updated?.headingDeg).toBe(20);
    expect(readFileSync(filePath, 'utf8')).toBe(original);
  });
});

describe('CamerasService rail bench', () => {
  const originalCamerasFile = process.env.CAMERAS_FILE;
  let service: CamerasService;

  beforeEach(() => {
    process.env.CAMERAS_FILE = join(tmpdir(), 'pavois-no-cameras.json');
    service = new CamerasService();
  });

  afterEach(() => {
    if (originalCamerasFile === undefined) {
      delete process.env.CAMERAS_FILE;
    } else {
      process.env.CAMERAS_FILE = originalCamerasFile;
    }
  });

  it('overlays metre poses without writing GPS to disk', () => {
    expect(service.isRailBenchActive()).toBe(false);
    const bench = service.applyRailBench({ rangeM: 2.5 });
    expect(bench.cameras[1].id).toBe('jean');
    expect(service.isRailBenchActive()).toBe(true);
    const jean = service.list().find((c) => c.id === 'jean');
    expect(jean?.localX).toBe(0);
    expect(jean?.localY).toBe(0);
    expect(jean?.localHeadingDeg).toBe(0);
    expect(service.localPose('tanel')?.x).toBeCloseTo(3 / 7);
    service.clearRailBench();
    expect(service.list().find((c) => c.id === 'jean')?.localX).toBeUndefined();
  });

  it('persists and uses a measured ChArUco pose instead of the ideal rail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pavois-rail-calib-'));
    const filePath = join(dir, 'cameras.json');
    process.env.CAMERAS_FILE = filePath;
    const isolated = new CamerasService();

    expect(
      isolated.updateRailCalibration('jean', {
        id: 'jean',
        x: 0.012,
        y: -0.034,
        z: 0.71,
        headingDeg: 359.8,
        elevationDeg: 18.6,
        rollDeg: -0.7,
      }),
    ).toBe(true);

    const bench = isolated.applyRailBench();
    expect(bench.cameras.find((camera) => camera.id === 'jean')).toMatchObject({
      x: 0.012,
      y: -0.034,
      z: 0.71,
      headingDeg: 359.8,
      elevationDeg: 18.6,
      rollDeg: -0.7,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'jean', railX: 0.012, railZ: 0.71 }),
      ]),
    );
  });
});
