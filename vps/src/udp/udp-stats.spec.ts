import { parseCameraStatsLine } from './udp-stats';

describe('parseCameraStatsLine', () => {
  it('parses a Pi capture/detect fps v1 line', () => {
    const stats = parseCameraStatsLine('stats,jean,12.5,240,1775312345678');
    expect(stats).toEqual({
      type: 'camera_stats',
      version: 'v1',
      cameraId: 'jean',
      fps: 12.5,
      frameIndex: 240,
      timestamp: 1775312345678,
    });
  });

  it('parses a Pi capture/detect fps v2 line with diagnostic metrics', () => {
    const stats = parseCameraStatsLine(
      'stats,v2,jean,29.8,1042,1775312345678,12.4,3.1,0.02,14.5,10000,6.0',
    );
    expect(stats).toEqual({
      type: 'camera_stats',
      version: 'v2',
      cameraId: 'jean',
      fps: 29.8,
      frameIndex: 1042,
      timestamp: 1775312345678,
      lumMean: 12.4,
      lumStddev: 3.1,
      frameDiff: 0.02,
      laplacianVar: 14.5,
      exposureUs: 10000,
      gainDb: 6.0,
    });
  });

  it('rejects a negative fps or a short line', () => {
    expect(parseCameraStatsLine('stats,jean,-1,1,1')).toBeNull();
    expect(parseCameraStatsLine('stats,jean,10')).toBeNull();
  });
});
