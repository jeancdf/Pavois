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

  it('rejects a negative fps or a short line', () => {
    expect(parseCameraStatsLine('stats,jean,-1,1,1')).toBeNull();
    expect(parseCameraStatsLine('stats,jean,10')).toBeNull();
  });
});
