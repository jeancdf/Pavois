/**
 * Layout of the V5 rail bench in metres, jean at the origin.
 * Two rail modules sit between each camera on a 1 m rig:
 * pitch = width/7, adjacent baseline = 3 pitches.
 * Forward is +Y (heading 0). Elevation matches the V2 mount.
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function railPitchMm(rigWidthMm = DEFAULT_RIG_WIDTH_MM): number {
  return rigWidthMm / 7;
}

export function adjacentBaselineM(
  rigWidthMm = DEFAULT_RIG_WIDTH_MM,
): number {
  return (3 * railPitchMm(rigWidthMm)) / 1000;
}

export function expectedTarget(
  rangeM = DEFAULT_RANGE_M,
  hoverM = DEFAULT_HOVER_M,
): Vec3m {
  return { x: 0, y: rangeM, z: hoverM };
}

export function railCameraPoses(
  options: RailBenchOptions = {},
): RailLocalPose[] {
  const width = options.rigWidthMm ?? DEFAULT_RIG_WIDTH_MM;
  const heading = options.headingDeg ?? DEFAULT_HEADING_DEG;
  const elevation = options.elevationDeg ?? DEFAULT_ELEVATION_DEG;
  const baseline = adjacentBaselineM(width);
  const ids: RailCameraId[] = ['tanel', 'jean', 'walid'];
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

export function buildRailBenchState(
  options: RailBenchOptions = {},
): RailBenchState {
  const rigWidthMm = clamp(
    options.rigWidthMm ?? DEFAULT_RIG_WIDTH_MM,
    840,
    1050,
  );
  const rangeM = clamp(options.rangeM ?? DEFAULT_RANGE_M, 0.5, 20);
  const targetSizeM = clamp(
    options.targetSizeM ?? DEFAULT_TARGET_SIZE_M,
    0.05,
    2,
  );
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

export function isRailCameraId(id: string): id is RailCameraId {
  return (RAIL_CAMERA_IDS as readonly string[]).includes(id);
}

export function localPoseOf(
  state: RailBenchState | null,
  cameraId: string,
): RailLocalPose | null {
  if (!state) return null;
  return state.cameras.find((camera) => camera.id === cameraId) ?? null;
}
