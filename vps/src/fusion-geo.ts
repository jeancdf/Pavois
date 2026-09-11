export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ray {
  origin: Vec3;
  direction: Vec3; // direction unit
}

export interface CameraPose {
  x: number;
  y: number;
  z: number; // ENU metres
  headingDeg: number;
  elevationDeg: number;
  rollDeg: number;
}

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  k1: number;
  k2: number;
  fovDeg: number;
  imageWidth: number;
  imageHeight: number;
}

const kDeg = Math.PI / 180.0;
const kEarthRadiusM = 6378137.0;

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vNorm(v: Vec3): number {
  return Math.sqrt(vDot(v, v));
}

export function normalize(v: Vec3): Vec3 {
  const n = vNorm(v);
  return n <= 1e-12 ? { x: 0, y: 0, z: 0 } : vScale(v, 1.0 / n);
}

export function cameraBasis(pose: CameraPose): {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const h = pose.headingDeg * kDeg;
  const e = pose.elevationDeg * kDeg;
  const roll = pose.rollDeg * kDeg;

  // ENU: x = East, y = North, z = Up. Compass heading is CW from North.
  const forward: Vec3 = {
    x: Math.sin(h) * Math.cos(e),
    y: Math.cos(h) * Math.cos(e),
    z: Math.sin(e),
  };
  // right is horizontal, 90 deg CW from the ground track
  // (East when facing North).
  let right: Vec3 = { x: Math.cos(h), y: -Math.sin(h), z: 0.0 };
  let up = normalize(vCross(right, forward));

  if (roll !== 0.0) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const r2 = vAdd(vScale(right, cr), vScale(up, sr));
    const u2 = vAdd(vScale(up, cr), vScale(right, -sr));
    right = r2;
    up = u2;
  }
  return {
    forward: normalize(forward),
    right: normalize(right),
    up,
  };
}

export function effectiveIntrinsics(
  partial: Partial<CameraIntrinsics> & {
    imageWidth?: number;
    imageHeight?: number;
    fovDeg?: number;
    fx?: number;
    fy?: number;
    cx?: number;
    cy?: number;
  },
): CameraIntrinsics {
  const imageWidth = partial.imageWidth ?? 0;
  const imageHeight = partial.imageHeight ?? 0;
  const fovDeg = partial.fovDeg ?? 0;
  let fx = partial.fx ?? 0;
  let fy = partial.fy ?? 0;
  let cx = partial.cx ?? 0;
  let cy = partial.cy ?? 0;
  const k1 = partial.k1 ?? 0;
  const k2 = partial.k2 ?? 0;

  if (fx <= 0.0) {
    const half = fovDeg * 0.5 * kDeg;
    fx =
      half > 1e-6 && imageWidth > 0
        ? (imageWidth * 0.5) / Math.tan(half)
        : Math.max(1, imageWidth);
  }
  if (fy <= 0.0) {
    fy = fx;
  }
  if (cx <= 0.0) {
    cx = imageWidth * 0.5;
  }
  if (cy <= 0.0) {
    cy = imageHeight * 0.5;
  }
  return {
    fx,
    fy,
    cx,
    cy,
    k1,
    k2,
    fovDeg,
    imageWidth,
    imageHeight,
  };
}

export function undistortPixel(
  intr: CameraIntrinsics,
  px: number,
  py: number,
): { xn: number; yn: number } {
  const xd = (px - intr.cx) / intr.fx;
  const yd = (py - intr.cy) / intr.fy;
  let xn = xd;
  let yn = yd;
  if (intr.k1 === 0.0 && intr.k2 === 0.0) {
    return { xn, yn };
  }
  // Iterative inverse of x_d = x_u (1 + k1 r^2 + k2 r^4).
  for (let i = 0; i < 8; i++) {
    const r2 = xn * xn + yn * yn;
    const f = 1.0 + intr.k1 * r2 + intr.k2 * r2 * r2;
    xn = xd / f;
    yn = yd / f;
  }
  return { xn, yn };
}

export function pixelToRay(
  intr: CameraIntrinsics,
  pose: CameraPose,
  px: number,
  py: number,
): Ray {
  const { xn, yn } = undistortPixel(intr, px, py);
  const b = cameraBasis(pose);
  // image +x -> right, image +y is down -> -up.
  const dir = vAdd(b.forward, vAdd(vScale(b.right, xn), vScale(b.up, -yn)));
  return {
    origin: { x: pose.x, y: pose.y, z: pose.z },
    direction: normalize(dir),
  };
}

export function projectWorldToPixel(
  intr: CameraIntrinsics,
  pose: CameraPose,
  world: Vec3,
): [number, number] | null {
  const b = cameraBasis(pose);
  const rel = vSub(world, { x: pose.x, y: pose.y, z: pose.z });
  const zc = vDot(rel, b.forward);
  if (zc <= 1e-6) {
    return null;
  }
  const xc = vDot(rel, b.right);
  const yc = -vDot(rel, b.up);
  let xn = xc / zc;
  let yn = yc / zc;
  const r2 = xn * xn + yn * yn;
  const f = 1.0 + intr.k1 * r2 + intr.k2 * r2 * r2;
  xn *= f;
  yn *= f;
  return [intr.cx + intr.fx * xn, intr.cy + intr.fy * yn];
}

function gaussJordan(A: number[], b: number[]): Vec3 | null {
  const M = [
    [A[0], A[1], A[2], b[0]],
    [A[3], A[4], A[5], b[1]],
    [A[6], A[7], A[8], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      return null;
    }
    if (pivot !== col) {
      for (let k = col; k < 4; k++) {
        const tmp = M[col][k];
        M[col][k] = M[pivot][k];
        M[pivot][k] = tmp;
      }
    }
    const div = M[col][col];
    for (let k = col; k < 4; k++) {
      M[col][k] /= div;
    }
    for (let row = 0; row < 3; row++) {
      if (row === col) {
        continue;
      }
      const factor = M[row][col];
      for (let k = col; k < 4; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }
  return { x: M[0][3], y: M[1][3], z: M[2][3] };
}

export function leastSquaresIntersection(
  rays: Ray[],
  weights?: number[],
): Vec3 | null {
  if (rays.length < 2) {
    return null;
  }
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0.0, 0.0, 0.0];
  const wts = weights ?? [];
  for (let idx = 0; idx < rays.length; idx++) {
    const d = normalize(rays[idx].direction);
    const w = wts.length === 0 ? 1.0 : Math.max(1e-6, wts[idx]);
    const P = [
      w * (1.0 - d.x * d.x),
      w * (-d.x * d.y),
      w * (-d.x * d.z),
      w * (-d.y * d.x),
      w * (1.0 - d.y * d.y),
      w * (-d.y * d.z),
      w * (-d.z * d.x),
      w * (-d.z * d.y),
      w * (1.0 - d.z * d.z),
    ];
    for (let i = 0; i < 9; i++) {
      A[i] += P[i];
    }
    const p = rays[idx].origin;
    b[0] += P[0] * p.x + P[1] * p.y + P[2] * p.z;
    b[1] += P[3] * p.x + P[4] * p.y + P[5] * p.z;
    b[2] += P[6] * p.x + P[7] * p.y + P[8] * p.z;
  }
  return gaussJordan(A, b);
}

export function rayResidual(ray: Ray, point: Vec3): number {
  const d = normalize(ray.direction);
  const w = vSub(point, ray.origin);
  return vNorm(vCross(w, d));
}

export function minPairwiseAngleDeg(rays: Ray[]): number {
  let best = 180.0;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const di = normalize(rays[i].direction);
      const dj = normalize(rays[j].direction);
      const c = Math.min(1.0, Math.max(-1.0, vDot(di, dj)));
      best = Math.min(best, Math.acos(c) / kDeg);
    }
  }
  return best;
}

/** ENU local: x East, y North, z Up. Same formula as pavois++ gps_to_local_approx. */
export function gpsToEnu(
  latDeg: number,
  lonDeg: number,
  altM: number,
  originLat: number,
  originLon: number,
  originAlt: number,
): Vec3 {
  const lat = latDeg * kDeg;
  const originLatR = originLat * kDeg;
  const originLonR = originLon * kDeg;
  const lon = lonDeg * kDeg;
  const meanLat = (lat + originLatR) * 0.5;
  return {
    x: (lon - originLonR) * Math.cos(meanLat) * kEarthRadiusM,
    y: (lat - originLatR) * kEarthRadiusM,
    z: altM - originAlt,
  };
}

/** Compass look-at, same as scene_sim.hpp look_at. */
export function lookAt(eye: Vec3, target: Vec3): CameraPose {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  return {
    x: eye.x,
    y: eye.y,
    z: eye.z,
    headingDeg: Math.atan2(dx, dy) / kDeg,
    elevationDeg: Math.atan2(dz, Math.sqrt(dx * dx + dy * dy)) / kDeg,
    rollDeg: 0,
  };
}

export function makeIntrinsics(
  w: number,
  h: number,
  fovDeg: number,
  k1 = 0,
  k2 = 0,
): CameraIntrinsics {
  const fx = (w * 0.5) / Math.tan(fovDeg * 0.5 * kDeg);
  return {
    imageWidth: w,
    imageHeight: h,
    fovDeg,
    fx,
    fy: fx,
    cx: w * 0.5,
    cy: h * 0.5,
    k1,
    k2,
  };
}
