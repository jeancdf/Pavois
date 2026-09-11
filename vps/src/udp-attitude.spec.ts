import {
  headingDeltaDeg,
  parseAttitudeLine,
  wrapHeadingDeg,
} from './udp-attitude';

describe('udp attitude packets', () => {
  it('parses a v2 att line with calibration and validity', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3,3013,1');
    expect(parsed).toEqual({
      cameraId: 'jean',
      timestamp: 12345,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
      calibration: { sys: 3, gyro: 0, accel: 1, mag: 3 },
      valid: true,
    });
  });

  it('keeps accepting the v1 att line from older Pi firmware', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3');
    expect(parsed).toEqual({
      cameraId: 'jean',
      timestamp: 12345,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
      calibration: null,
      valid: true,
    });
  });

  it('flags a frozen heading when the Pi failed its IMU read', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3,-,0');
    expect(parsed?.valid).toBe(false);
    expect(parsed?.calibration).toBeNull();
  });

  it('treats `-` as unknown calibration on a valid read', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3,-,1');
    expect(parsed?.valid).toBe(true);
    expect(parsed?.calibration).toBeNull();
  });

  it('accepts a calibration token without the validity field', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3,3333');
    expect(parsed?.calibration).toEqual({ sys: 3, gyro: 3, accel: 3, mag: 3 });
    expect(parsed?.valid).toBe(true);
  });

  it('keeps unknown levels as null (BNO08x only reports the magnetometer)', () => {
    const parsed = parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,---2,1');
    expect(parsed?.calibration).toEqual({
      sys: null,
      gyro: null,
      accel: null,
      mag: 2,
    });
  });

  it('treats an all-unknown SGAM token like `-`', () => {
    const parsed = parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,----,1');
    expect(parsed?.calibration).toBeNull();
  });

  it('rejects malformed calibration tokens', () => {
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,3403,1')).toBeNull();
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,3-x3,1')).toBeNull();
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,333,1')).toBeNull();
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,,1')).toBeNull();
  });

  it('rejects malformed validity flags', () => {
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,3333,2')).toBeNull();
    expect(parseAttitudeLine('att,jean,1,164.2,-1.5,0.3,3333,true')).toBeNull();
  });

  it('rejects invented tokens that are not att packets', () => {
    expect(parseAttitudeLine('raw,jean,1,0,1,1,1,1')).toBeNull();
    expect(parseAttitudeLine('att,jean')).toBeNull();
  });

  it('wraps heading across 360 degrees', () => {
    expect(wrapHeadingDeg(370)).toBeCloseTo(10);
    expect(wrapHeadingDeg(-20)).toBeCloseTo(340);
    expect(headingDeltaDeg(359, 1)).toBeCloseTo(2);
  });
});
