import {
  headingDeltaDeg,
  parseAttitudeLine,
  wrapHeadingDeg,
} from './udp-attitude';

describe('udp attitude packets', () => {
  it('parses an att line from the Pi', () => {
    const parsed = parseAttitudeLine('att,jean,12345,164.2,-1.5,0.3');
    expect(parsed).toEqual({
      cameraId: 'jean',
      timestamp: 12345,
      headingDeg: 164.2,
      elevationDeg: -1.5,
      rollDeg: 0.3,
    });
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
