import {
  adjacentBaselineM,
  buildRailBenchState,
  distanceM,
  expectedTarget,
  railVoxelOf,
  railPitchMm,
  railVolumePoints,
} from './rail-bench';

describe('rail bench volume points', () => {
  it('uses two rails between cameras on a 1 m rig', () => {
    expect(railPitchMm(1000)).toBeCloseTo(1000 / 7);
    expect(adjacentBaselineM(1000)).toBeCloseTo(3 / 7);
  });

  it('puts the 20 cm drone 2.5 m in front of jean', () => {
    const mark = expectedTarget(2.5, 0.4);
    expect(mark).toEqual({ x: 0, y: 2.5, z: 0.4 });
    const bench = buildRailBenchState({ rangeM: 2.5, targetSizeM: 0.2 });
    const estimated = { x: 0.1, y: 2.4, z: 0.45 };
    const points = railVolumePoints(bench, estimated);
    expect(points.map((p) => p.kind)).toEqual([
      'camera',
      'camera',
      'camera',
      'expected',
      'estimated',
    ]);
    expect(points.find((p) => p.id === 'jean')).toMatchObject({
      x: 0,
      y: 0,
      z: 0,
    });
    expect(distanceM(bench.expected, estimated)).toBeCloseTo(
      Math.hypot(0.1, 0.1, 0.05),
    );
  });

  it('quantizes raw intersections into 5 cm display voxels', () => {
    const voxel = railVoxelOf({ x: 0.024, y: 2.526, z: 0.401 });
    expect(voxel).toMatchObject({
      key: '0:51:8',
      x: 0,
      z: 0.4,
      hits: 1,
    });
    expect(voxel?.y).toBeCloseTo(2.55);
    expect(railVoxelOf({ x: Number.NaN, y: 0, z: 0 })).toBeNull();
  });
});
