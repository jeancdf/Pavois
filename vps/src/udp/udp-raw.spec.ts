import { parseRawDetectionLine } from './udp-raw';

describe('udp raw detection packets', () => {
  it('parses a legacy 8-field raw line', () => {
    const line = 'raw,cam0,275,19128667926,551.93,638.21,2619,0.986';
    expect(parseRawDetectionLine(line)).toEqual({
      type: 'raw_detection',
      cameraId: 'cam0',
      frameIndex: 275,
      timestamp: 19128667926,
      x: 551.93,
      y: 638.21,
      size: 2619,
      confidence: 0.986,
    });
  });

  it('parses an 11-field line with pose', () => {
    const line = 'raw,jean,12,19128667926,551.93,638.21,42,0.9,164.2,-1.5,0.3';
    expect(parseRawDetectionLine(line)).toEqual({
      type: 'raw_detection',
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 19128667926,
      x: 551.93,
      y: 638.21,
      size: 42,
      confidence: 0.9,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
    });
  });

  it('parses pose plus camera intrinsics', () => {
    const line =
      'raw,jean,12,19128667926,551.93,638.21,42,0.9,' +
      '164.2,-1.5,0.3,800,800,320,240,70';
    expect(parseRawDetectionLine(line)).toEqual({
      type: 'raw_detection',
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 19128667926,
      x: 551.93,
      y: 638.21,
      size: 42,
      confidence: 0.9,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
      fx: 800,
      fy: 800,
      cx: 320,
      cy: 240,
      fovDeg: 70,
    });
  });

  it('parses calibrated distortion and rail pose', () => {
    const line =
      'raw,jean,12,19128667926,551.93,638.21,42,0.9,' +
      '164.2,-1.5,0.3,800,801,640,360,77.3,' +
      '-0.21,0.04,0.001,-0.002,0.005,' +
      '0.012,-0.034,0.71,359.8,18.6,-0.7';
    expect(parseRawDetectionLine(line)).toMatchObject({
      cameraId: 'jean',
      fx: 800,
      fy: 801,
      k1: -0.21,
      k2: 0.04,
      p1: 0.001,
      p2: -0.002,
      k3: 0.005,
      railX: 0.012,
      railY: -0.034,
      railZ: 0.71,
      railHeadingDeg: 359.8,
      railElevationDeg: 18.6,
      railRollDeg: -0.7,
    });
  });

  it('rejects invented tokens that are not raw packets', () => {
    expect(parseRawDetectionLine('att,jean,12345,164.2,-1.5,0.3')).toBeNull();
  });

  it('rejects lines shorter than 8 fields', () => {
    expect(parseRawDetectionLine('raw,cam0,275,1,1,1')).toBeNull();
  });

  it('omits incomplete pose and still returns the detection', () => {
    const line = 'raw,jean,12,19128667926,551.93,638.21,42,0.9,164.2,-1.5';
    expect(parseRawDetectionLine(line)).toEqual({
      type: 'raw_detection',
      cameraId: 'jean',
      frameIndex: 12,
      timestamp: 19128667926,
      x: 551.93,
      y: 638.21,
      size: 42,
      confidence: 0.9,
    });
  });

  it('wraps heading 370 degrees to 10', () => {
    const line = 'raw,jean,12,19128667926,551.93,638.21,42,0.9,370,-1.5,0.3';
    const parsed = parseRawDetectionLine(line);
    expect(parsed?.headingDeg).toBeCloseTo(10);
    expect(parsed?.elevationDeg).toBe(-1.5);
    expect(parsed?.rollDeg).toBe(0.3);
  });
});
