import { KalmanCV } from './fusion-kalman';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

describe('KalmanCV', () => {
  it('converges on a 2D constant-velocity trajectory', () => {
    const kf = new KalmanCV();
    kf.init(2, [0, 0], 1.0, 0.5);
    const rng = mulberry32(1);
    const vx = 3.0;
    const vy = -1.5;
    const dt = 0.1;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 200; i++) {
      x += vx * dt;
      y += vy * dt;
      kf.predict(dt);
      kf.update([x + gaussian(rng) * 0.5, y + gaussian(rng) * 0.5]);
    }
    expect(Math.abs(kf.position()[0] - x)).toBeLessThan(1.0);
    expect(Math.abs(kf.position()[1] - y)).toBeLessThan(1.0);
    expect(Math.abs(kf.velocity()[0] - vx)).toBeLessThan(0.6);
    expect(Math.abs(kf.velocity()[1] - vy)).toBeLessThan(0.6);
  });

  it('converges on a 3D constant-velocity trajectory', () => {
    const kf = new KalmanCV();
    kf.init(3, [1, 2, 3], 5.0, 1.0);
    const rng = mulberry32(2);
    const p = { x: 1, y: 2, z: 3 };
    const v = { x: 2, y: -1, z: 0.5 };
    const dt = 0.05;
    for (let i = 0; i < 300; i++) {
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
      kf.predict(dt);
      kf.update([
        p.x + gaussian(rng) * 1.0,
        p.y + gaussian(rng) * 1.0,
        p.z + gaussian(rng) * 1.0,
      ]);
    }
    const speed = Math.hypot(v.x, v.y, v.z);
    expect(Math.abs(kf.position()[0] - p.x)).toBeLessThan(2.0);
    expect(Math.abs(kf.position()[2] - p.z)).toBeLessThan(2.0);
    expect(Math.abs(kf.speed() - speed)).toBeLessThan(1.0);
  });

  it('gating grows with residual and predict inflates P', () => {
    const kf = new KalmanCV();
    kf.init(3, [0, 0, 0], 1.0, 1.0);
    for (let i = 0; i < 20; i++) {
      kf.predict(0.1);
      kf.update([0, 0, 0]);
    }
    const dIn = kf.gatingDistance([0.5, 0, 0]);
    const dOut = kf.gatingDistance([50, 0, 0]);
    expect(dIn).toBeLessThan(dOut);
    expect(dIn).toBeLessThan(5.0);
    const u0 = kf.positionUncertainty();
    kf.predict(1.0);
    expect(kf.positionUncertainty()).toBeGreaterThan(u0);
    const u1 = kf.positionUncertainty();
    kf.update([0, 0, 0]);
    expect(kf.positionUncertainty()).toBeLessThan(u1);
  });
});
