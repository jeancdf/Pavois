import { parseCameraStatsLine } from './udp-stats';

describe('parseCameraStatsLine', () => {
  it('parses a Pi capture/detect fps line', () => {
    const stats = parseCameraStatsLine('stats,jean,12.5,240,1775312345678');
    expect(stats).toEqual({
      type: 'camera_stats',
      cameraId: 'jean',
      fps: 12.5,
      frameIndex: 240,
      timestamp: 1775312345678,
    });
  });

  it('parses capture, drop, detector time and temperature telemetry', () => {
    const stats = parseCameraStatsLine(
      'stats,tanel,29.7,420,1775312345678,30.0,3,21.4,62.5',
    );
    expect(stats).toMatchObject({
      cameraId: 'tanel',
      fps: 29.7,
      captureFps: 30,
      droppedFrames: 3,
      detectorMs: 21.4,
      temperatureC: 62.5,
    });
  });

  it('rejects a negative fps or a short line', () => {
    expect(parseCameraStatsLine('stats,jean,-1,1,1')).toBeNull();
    expect(parseCameraStatsLine('stats,jean,10')).toBeNull();
  });
});
