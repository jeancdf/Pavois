import type {
  CameraIntrinsics,
  CameraPose,
  Vec3,
} from '../geometry/fusion-geo';
import {
  lookAt,
  makeIntrinsics,
  projectWorldToPixel,
  vNorm,
  vSub,
} from '../geometry/fusion-geo';
import {
  pairIntersections,
  triangulate,
  type TriangulateObservation,
  type TriangulationConfig,
} from './fusion-triangulate';

const NO_SUBSET = 'no subset passed parallax/residual gates';
const NEED_OBS = 'need >= 2 observations';

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

function makeObs(
  target: Vec3,
  poses: CameraPose[],
  intrinsics: CameraIntrinsics,
  noisePx: number,
  rng: () => number,
  quality = 0.8,
): TriangulateObservation[] {
  const obs: TriangulateObservation[] = [];
  for (let i = 0; i < poses.length; i++) {
    const pair = projectWorldToPixel(intrinsics, poses[i], target);
    if (!pair) continue;
    const nx = noisePx === 0 ? 0 : gaussian(rng) * noisePx;
    const ny = noisePx === 0 ? 0 : gaussian(rng) * noisePx;
    obs.push({
      cameraId: 'cam' + i,
      pixelX: pair[0] + nx,
      pixelY: pair[1] + ny,
      quality,
      pose: poses[i],
      intrinsics,
    });
  }
  return obs;
}

describe('triangulate', () => {
  const target: Vec3 = { x: 2, y: 30, z: 12 };
  const cfg: Partial<TriangulationConfig> = {
    minParallaxDeg: 1.5,
    maxResidualM: 3,
    maxRangeM: 80,
  };
  const intrinsics = makeIntrinsics(1280, 720, 70);

  function threePoses(): CameraPose[] {
    return [
      lookAt({ x: -12, y: -2, z: 2 }, target),
      lookAt({ x: 11, y: 1, z: 2 }, target),
      lookAt({ x: 0, y: -14, z: 3 }, target),
    ];
  }

  it('triangulates three converging cameras', () => {
    const rng = mulberry32(7);
    const obs = makeObs(target, threePoses(), intrinsics, 0, rng);
    const r = triangulate(obs, cfg);
    expect(r.ok).toBe(true);
    expect(r.cameras).toHaveLength(3);
    expect(r.point).not.toBeNull();
    expect(vNorm(vSub(r.point as Vec3, target))).toBeLessThan(0.5);
  });

  it('rejects nearly collinear cameras', () => {
    const rng = mulberry32(7);
    const poses = [
      lookAt({ x: 0, y: 0, z: 2 }, target),
      lookAt({ x: 0.15, y: 0, z: 2 }, target),
    ];
    const obs = makeObs(target, poses, intrinsics, 0.2, rng);
    const r = triangulate(obs, cfg);
    expect(r.ok).toBe(false);
    expect(r.rejectReason).toBe(NO_SUBSET);
    const raw = pairIntersections(obs, 80);
    expect(raw).toHaveLength(1);
    expect(raw[0].cameras).toEqual(['cam0', 'cam1']);
    expect(raw[0].parallaxDeg).toBeLessThan(cfg.minParallaxDeg!);
    expect(Number.isFinite(raw[0].point.x)).toBe(true);
    expect(Number.isFinite(raw[0].point.y)).toBe(true);
    expect(Number.isFinite(raw[0].point.z)).toBe(true);
  });

  it('rejects identical poses', () => {
    const rng = mulberry32(7);
    const pose = lookAt({ x: -12, y: -2, z: 2 }, target);
    const obs = makeObs(target, [pose, pose], intrinsics, 0, rng);
    const r = triangulate(obs, cfg);
    expect(r.ok).toBe(false);
    expect(r.rejectReason).toBe(NO_SUBSET);
  });

  it('never intersects two blobs originating from the same camera', () => {
    const rng = mulberry32(7);
    const obs = makeObs(target, threePoses().slice(0, 2), intrinsics, 0, rng);
    const secondJeanBlob = { ...obs[0], pixelX: obs[0].pixelX + 30 };
    const raw = pairIntersections([obs[0], secondJeanBlob, obs[1]], 80);
    expect(raw).toHaveLength(2);
    expect(
      raw.every(
        (intersection) => intersection.cameras[0] !== intersection.cameras[1],
      ),
    ).toBe(true);
  });

  it('rejects an over-range solution', () => {
    const rng = mulberry32(7);
    const obs = makeObs(target, threePoses(), intrinsics, 0, rng);
    const r = triangulate(obs, { ...cfg, maxRangeM: 5 });
    expect(r.ok).toBe(false);
  });

  it('drops a single outlier camera', () => {
    const rng = mulberry32(7);
    const obs = makeObs(target, threePoses(), intrinsics, 0, rng);
    obs[1].pixelX += 190;
    obs[1].pixelY -= 130;
    const r = triangulate(obs, cfg);
    expect(r.ok).toBe(true);
    expect(r.cameras).toHaveLength(2);
  });

  it('rejects fewer than two observations', () => {
    const rng = mulberry32(7);
    const obs = makeObs(target, threePoses(), intrinsics, 0, rng);
    expect(triangulate([], cfg).ok).toBe(false);
    expect(triangulate([], cfg).rejectReason).toBe(NEED_OBS);
    expect(triangulate([obs[0]], cfg).ok).toBe(false);
    expect(triangulate([obs[0]], cfg).rejectReason).toBe(NEED_OBS);
  });

  it('reports a covariance stretched along the viewing direction', () => {
    const rng = mulberry32(7);
    const poses = [
      lookAt({ x: -3, y: 0, z: 2 }, target),
      lookAt({ x: 3, y: 0, z: 2 }, target),
    ];
    const r = triangulate(makeObs(target, poses, intrinsics, 0, rng), cfg);
    expect(r.ok).toBe(true);
    const cov = r.covariance!;
    // Caméras rapprochées le long de x : la profondeur (y) est bien moins
    // sûre que x.
    expect(cov[4]).toBeGreaterThan(cov[0] * 10);
    expect(r.residualPx).toBeLessThan(0.5);
  });

  it('weighs rays in pixels so a far camera still counts', () => {
    const rng = mulberry32(11);
    const poses = [
      lookAt({ x: -12, y: -2, z: 2 }, target),
      lookAt({ x: 11, y: 1, z: 2 }, target),
      lookAt({ x: 0, y: 25, z: 3 }, target),
    ];
    let err = 0;
    for (let k = 0; k < 20; k++) {
      const obs = makeObs(target, poses, intrinsics, 1.0, rng);
      const r = triangulate(obs, cfg);
      expect(r.ok).toBe(true);
      err += vNorm(vSub(r.point as Vec3, target));
    }
    expect(err / 20).toBeLessThan(0.1);
  });
});
