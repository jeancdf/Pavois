import {
  adjacentBaselineM,
  buildRailBenchState,
  expectedTarget,
  railPitchMm,
} from './rail-bench';
import { makeIntrinsics } from '../fusion/geometry/fusion-geo';
import { triangulate } from '../fusion/triangulation/fusion-triangulate';

describe('rail-bench geometry', () => {
  it('places tanel / jean / walid 3 pitches apart on a 1 m rig', () => {
    expect(railPitchMm(1000)).toBeCloseTo(1000 / 7);
    expect(adjacentBaselineM(1000)).toBeCloseTo(3 / 7);
    const state = buildRailBenchState({ rangeM: 2.5, targetSizeM: 0.2 });
    expect(state.cameras.map((c) => c.id)).toEqual([
      'tanel',
      'jean',
      'walid',
    ]);
    expect(state.cameras[1]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(state.cameras[0].x).toBeCloseTo(-3 / 7);
    expect(state.cameras[2].x).toBeCloseTo(3 / 7);
    expect(state.cameras[0].headingDeg).toBe(0);
    expect(state.cameras[0].elevationDeg).toBe(20);
  });

  it('puts the 20 cm drone mark in front of jean', () => {
    const mark = expectedTarget(2.5, 0.4);
    expect(mark).toEqual({ x: 0, y: 2.5, z: 0.4 });
    const state = buildRailBenchState({ rangeM: 3, hoverM: 0.4 });
    expect(state.expected.y).toBe(3);
    expect(state.targetSizeM).toBe(0.2);
  });

  it('triangulates real rail pixels with tanel on the left and walid on the right', () => {
    const state = buildRailBenchState();
    // One instant of the flight of 2026-10-03: a 10 cm drone about 2 m from
    // the rail, seen by the three Pis in 1024 x 576.
    const pixels: Record<string, [number, number]> = {
      jean: [572.49, 494.63],
      tanel: [809.38, 452.65],
      walid: [192.79, 467.44],
    };
    const intrinsics = makeIntrinsics(1024, 576, 41);
    const result = triangulate(
      state.cameras.map((camera) => ({
        cameraId: camera.id,
        pixelX: pixels[camera.id][0],
        pixelY: pixels[camera.id][1],
        quality: 0.95,
        pose: camera,
        intrinsics,
      })),
    );

    expect(result.ok).toBe(true);
    expect(result.cameras).toEqual(['tanel', 'jean', 'walid']);
    expect(result.point?.y).toBeCloseTo(1.9, 1);
    expect(result.point?.z).toBeCloseTo(0.41, 1);
  });
});
