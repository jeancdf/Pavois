import { routeUdpLine } from './udp-route';

describe('routeUdpLine', () => {
  it('routes an att line to kind att', () => {
    const line = 'att,jean,1775312345678,170,0.2,-1.1';
    const routed = routeUdpLine(line);
    expect(routed.kind).toBe('att');
    if (routed.kind !== 'att') return;
    expect(routed.attitude.cameraId).toBe('jean');
    expect(routed.attitude.headingDeg).toBe(170);
    expect(routed.attitude.elevationDeg).toBe(0.2);
    expect(routed.attitude.rollDeg).toBe(-1.1);
    expect(routed.attitude.timestamp).toBe(1775312345678);
  });

  it('routes a raw line to kind raw', () => {
    const line = 'raw,jean,12,1775312345678,12.3,0.8,42,0.42';
    const routed = routeUdpLine(line);
    expect(routed.kind).toBe('raw');
    if (routed.kind !== 'raw') return;
    expect(routed.detection.type).toBe('raw_detection');
    expect(routed.detection.cameraId).toBe('jean');
    expect(routed.detection.confidence).toBe(0.42);
    expect(routed.detection.x).toBe(12.3);
    expect(routed.detection.y).toBe(0.8);
    expect(routed.detection.size).toBe(42);
  });

  it('routes an obj line to a track_update payload', () => {
    const line = 'obj1,48.8566,2.3522,120,1775312345678';
    const routed = routeUdpLine(line);
    expect(routed).toEqual({
      kind: 'obj',
      track: {
        type: 'track_update',
        trackId: 'obj1',
        lat: 48.8566,
        lng: 2.3522,
        alt: 120,
        timestamp: 1775312345678,
      },
    });
  });

  it('routes an obj line with a classification', () => {
    const line = 'obj2,48.8,2.3,50,1,oiseau';
    const routed = routeUdpLine(line);
    expect(routed.kind).toBe('obj');
    if (routed.kind !== 'obj') return;
    expect(routed.track.trackId).toBe('obj2');
    expect(routed.track.lat).toBe(48.8);
    expect(routed.track.lng).toBe(2.3);
    expect(routed.track.alt).toBe(50);
    expect(routed.track.timestamp).toBe(1);
    expect(routed.track.classification).toBe('oiseau');
  });

  it('routes unknown CSV as kind unknown', () => {
    const routed = routeUdpLine('hello,world');
    expect(routed).toEqual({
      kind: 'unknown',
      raw: 'hello,world',
      data: null,
    });
  });

  it('routes unknown JSON with a parsed data object', () => {
    const routed = routeUdpLine('{"type":"ping"}');
    expect(routed).toEqual({
      kind: 'unknown',
      raw: '{"type":"ping"}',
      data: { type: 'ping' },
    });
  });

  it('drops a malformed att line with a non-numeric heading', () => {
    const line = 'att,jean,1775312345678,not-a-number,0,0';
    expect(routeUdpLine(line)).toEqual({ kind: 'drop' });
  });
});
