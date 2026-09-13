import {
  classifyKinematics,
  headingDegEnu,
  headingDeltaDeg,
  isClassifiableDt,
  parseExplicitClass,
  smoothSpeedAccel,
} from './fusion-classify';

describe('fusion-classify', () => {
  it('parses an explicit class case-insensitively', () => {
    expect(parseExplicitClass('Bird')).toBe('bird');
    expect(parseExplicitClass('DRONE')).toBe('drone');
    expect(parseExplicitClass('spaceship')).toBeUndefined();
    expect(parseExplicitClass(undefined)).toBeUndefined();
  });

  it('rejects a dt too small or too large', () => {
    expect(isClassifiableDt(0)).toBe(false);
    expect(isClassifiableDt(500)).toBe(false);
    expect(isClassifiableDt(1)).toBe(true);
  });

  it('classes airplane for fast high straight flight', () => {
    const result = classifyKinematics({
      speedMps: 90,
      accelMps2: 0,
      altM: 150,
      headingChangeDegPerS: 0,
    });
    expect(result.classification).toBe('airplane');
  });

  it('classes bird for a moderate speed at low altitude', () => {
    const result = classifyKinematics({
      speedMps: 15,
      accelMps2: 0,
      altM: 40,
      headingChangeDegPerS: 0,
    });
    expect(result.classification).toBe('bird');
  });

  it('classes other for a near-still ground object', () => {
    const result = classifyKinematics({
      speedMps: 2,
      accelMps2: 0,
      altM: 30,
      headingChangeDegPerS: 0,
    });
    expect(result.classification).toBe('other');
  });

  it('classes drone for a fast turn at racing speed', () => {
    const result = classifyKinematics({
      speedMps: 60,
      accelMps2: 0,
      altM: 90,
      headingChangeDegPerS: 180,
    });
    expect(result.classification).toBe('drone');
  });

  it('does not let hover-after-brake beat a slow ground score', () => {
    const result = classifyKinematics({
      speedMps: 1,
      accelMps2: 0,
      altM: 40,
      headingChangeDegPerS: 0,
      priorAccelMps2: 12,
    });
    expect(result.classification).toBe('other');
  });

  it('starts the speed filter at raw speed with zero accel', () => {
    const first = smoothSpeedAccel({ accel: 0 }, 10, 1);
    expect(first.speed).toBe(10);
    expect(first.accel).toBe(0);
    const second = smoothSpeedAccel(first, 10, 1);
    expect(second.speed).toBe(10);
    expect(second.accel).toBe(0);
  });

  it('computes ENU heading and wrapped delta', () => {
    expect(headingDegEnu(1, 0)).toBeCloseTo(0, 5);
    expect(headingDegEnu(0, 1)).toBeCloseTo(90, 5);
    expect(headingDeltaDeg(10, 350)).toBeCloseTo(20, 5);
  });
});
