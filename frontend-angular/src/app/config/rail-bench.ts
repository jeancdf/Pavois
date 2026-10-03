/**
 * Layout of the V5 rail bench in metres, jean at the origin.
 * Two rail modules sit between each camera on a 1 m rig.
 */

export const RAIL_CAMERA_IDS = ['tanel', 'jean', 'walid'] as const;
export type RailCameraId = (typeof RAIL_CAMERA_IDS)[number];

export const DEFAULT_RIG_WIDTH_MM = 1000;
export const DEFAULT_RANGE_M = 2.5;
export const DEFAULT_TARGET_SIZE_M = 0.2;
export const DEFAULT_HOVER_M = 0.4;
export const DEFAULT_HEADING_DEG = 0;
export const DEFAULT_ELEVATION_DEG = 20;
export const DEFAULT_ROLL_DEG = 0;
export const RAIL_VOXEL_SIZE_M = 0.05;
export const MAX_RAIL_VOXELS = 10_000;

export interface Vec3m {
  x: number;
  y: number;
  z: number;
}

export interface RailLocalPose extends Vec3m {
  id: RailCameraId;
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
}

export interface RailBenchOptions {
  rigWidthMm?: number;
  rangeM?: number;
  targetSizeM?: number;
  hoverM?: number;
  headingDeg?: number;
  elevationDeg?: number;
}

export interface RailBenchState {
  active: true;
  rigWidthMm: number;
  rangeM: number;
  targetSizeM: number;
  hoverM: number;
  headingDeg: number;
  elevationDeg: number;
  cameras: RailLocalPose[];
  expected: Vec3m;
}

export interface RailVolumePoint {
  id: string;
  kind: 'camera' | 'expected' | 'estimated';
  x: number;
  y: number;
  z: number;
}

export interface RailVoxel extends Vec3m {
  key: string;
  hits: number;
  cameras: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function railPitchMm(rigWidthMm = DEFAULT_RIG_WIDTH_MM): number {
  return rigWidthMm / 7;
}

export function adjacentBaselineM(rigWidthMm = DEFAULT_RIG_WIDTH_MM): number {
  return (3 * railPitchMm(rigWidthMm)) / 1000;
}

export function expectedTarget(rangeM = DEFAULT_RANGE_M, hoverM = DEFAULT_HOVER_M): Vec3m {
  return { x: 0, y: rangeM, z: hoverM };
}

export function railCameraPoses(options: RailBenchOptions = {}): RailLocalPose[] {
  const width = options.rigWidthMm ?? DEFAULT_RIG_WIDTH_MM;
  const heading = options.headingDeg ?? DEFAULT_HEADING_DEG;
  const elevation = options.elevationDeg ?? DEFAULT_ELEVATION_DEG;
  const baseline = adjacentBaselineM(width);
  const ids: RailCameraId[] = ['tanel', 'jean', 'walid'];
  // Physical rail order, seen from behind the cameras, is
  // tanel — jean — walid. Keep this mapping aligned with the backend.
  const xs = [-baseline, 0, baseline];
  return ids.map((id, index) => ({
    id,
    x: xs[index],
    y: 0,
    z: 0,
    headingDeg: heading,
    elevationDeg: elevation,
    rollDeg: DEFAULT_ROLL_DEG,
  }));
}

export function buildRailBenchState(options: RailBenchOptions = {}): RailBenchState {
  const rigWidthMm = clamp(options.rigWidthMm ?? DEFAULT_RIG_WIDTH_MM, 840, 1050);
  const rangeM = clamp(options.rangeM ?? DEFAULT_RANGE_M, 0.5, 20);
  const targetSizeM = clamp(options.targetSizeM ?? DEFAULT_TARGET_SIZE_M, 0.05, 2);
  const hoverM = clamp(options.hoverM ?? DEFAULT_HOVER_M, 0, 5);
  const headingDeg = options.headingDeg ?? DEFAULT_HEADING_DEG;
  const elevationDeg = options.elevationDeg ?? DEFAULT_ELEVATION_DEG;
  return {
    active: true,
    rigWidthMm,
    rangeM,
    targetSizeM,
    hoverM,
    headingDeg,
    elevationDeg,
    cameras: railCameraPoses({
      rigWidthMm,
      headingDeg,
      elevationDeg,
    }),
    expected: expectedTarget(rangeM, hoverM),
  };
}

export function distanceM(a: Vec3m, b: Vec3m): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Quantizes a raw ray intersection into a display-only grid cell. */
export function railVoxelOf(
  point: Vec3m,
  cameras: string[] = [],
  sizeM = RAIL_VOXEL_SIZE_M,
): RailVoxel | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z) ||
    !Number.isFinite(sizeM) ||
    sizeM <= 0
  ) {
    return null;
  }
  const ix = Math.round(point.x / sizeM);
  const iy = Math.round(point.y / sizeM);
  const iz = Math.round(point.z / sizeM);
  return {
    key: `${ix}:${iy}:${iz}`,
    x: ix === 0 ? 0 : ix * sizeM,
    y: iy === 0 ? 0 : iy * sizeM,
    z: iz === 0 ? 0 : iz * sizeM,
    hits: 1,
    cameras: cameras.slice(),
  };
}

/** Points drawn in the 3D volume (metres, jean at origin). */
export function railVolumePoints(
  bench: RailBenchState,
  estimated: Vec3m | null,
): RailVolumePoint[] {
  const points: RailVolumePoint[] = bench.cameras.map((camera) => ({
    id: camera.id,
    kind: 'camera',
    x: camera.x,
    y: camera.y,
    z: camera.z,
  }));
  points.push({
    id: 'expected',
    kind: 'expected',
    x: bench.expected.x,
    y: bench.expected.y,
    z: bench.expected.z,
  });
  if (estimated) {
    points.push({
      id: 'estimated',
      kind: 'estimated',
      x: estimated.x,
      y: estimated.y,
      z: estimated.z,
    });
  }
  return points;
}
