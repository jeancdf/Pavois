import {
  Ray,
  Vec3,
  enuToGps,
  gpsToEnu,
  leastSquaresIntersection,
  lookAt,
  makeIntrinsics,
  minPairwiseAngleDeg,
  normalize,
  pixelToRay,
  projectWorldToPixel,
  rayResidual,
  vNorm,
  vSub,
} from './fusion-geo';

describe('fusion-geo', () => {
  it('minPairwiseAngleDeg is ~45 deg for the selftest pair', () => {
    const a: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
    };
    const b: Ray = {
      origin: { x: 1, y: 0, z: 0 },
      direction: { x: -0.7071, y: 0.7071, z: 0 },
    };
    expect(minPairwiseAngleDeg([a, b])).toBeCloseTo(45, 0);
  });

  it('rayResidual is 0 on-ray and 2 for a 2m offset', () => {
    const ray: Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
    };
    expect(rayResidual(ray, { x: 0, y: 5, z: 0 })).toBeCloseTo(0, 9);
    expect(rayResidual(ray, { x: 2, y: 5, z: 0 })).toBeCloseTo(2, 9);
  });

  const meet: Vec3 = { x: 0, y: 20, z: 5 };
  const r1: Ray = {
    origin: { x: -10, y: 0, z: 0 },
    direction: normalize({ x: 10, y: 20, z: 5 }),
  };
  const r2: Ray = {
    origin: { x: 10, y: 0, z: 0 },
    direction: normalize({ x: -10, y: 20, z: 5 }),
  };
  const r3: Ray = {
    origin: { x: 0, y: -10, z: 0 },
    direction: normalize({ x: 0, y: 30, z: 5 }),
  };

  it('2-ray LS intersection hits {0,20,5}', () => {
    const p = leastSquaresIntersection([r1, r2]);
    expect(p).not.toBeNull();
    if (!p) {
      return;
    }
    expect(vNorm(vSub(p, meet))).toBeLessThan(1e-6);
  });

  it('3-ray LS intersection still hits {0,20,5}', () => {
    const p = leastSquaresIntersection([r1, r2, r3]);
    expect(p).not.toBeNull();
    if (!p) {
      return;
    }
    expect(vNorm(vSub(p, meet))).toBeLessThan(1e-6);
  });

  it('lookAt + project + pixelToRay residual is under 1e-6', () => {
    const target: Vec3 = { x: 3, y: 28, z: 14 };
    const pose = lookAt({ x: -8, y: 0, z: 2 }, target);
    const intr = makeIntrinsics(1280, 720, 70);
    const pix = projectWorldToPixel(intr, pose, target);
    expect(pix).not.toBeNull();
    if (!pix) {
      return;
    }
    const ray = pixelToRay(intr, pose, pix[0], pix[1]);
    expect(rayResidual(ray, target)).toBeLessThan(1e-6);
  });

  it('enuToGps inverts gpsToEnu', () => {
    const origin = { lat: 48.82608, lon: 2.3659, alt: 58.52 };
    const enu: Vec3 = { x: 2, y: 30, z: 12 };
    const gps = enuToGps(enu, origin);
    const back = gpsToEnu(
      gps.lat,
      gps.lng,
      gps.alt,
      origin.lat,
      origin.lon,
      origin.alt,
    );
    expect(vNorm(vSub(back, enu))).toBeLessThan(1e-6);
  });
});
