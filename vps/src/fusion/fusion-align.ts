import { FusionObservation } from './fusion.types';

export function observationTimeUs(obs: FusionObservation): number {
  return obs.timestampUs;
}

export function lerpObservation(
  a: FusionObservation,
  b: FusionObservation,
  f: number,
): FusionObservation {
  const nearer = f < 0.5 ? a : b;
  const o: FusionObservation = { ...nearer };
  o.x = a.x + (b.x - a.x) * f;
  o.y = a.y + (b.y - a.y) * f;
  o.confidence = Math.min(a.confidence, b.confidence);
  return o;
}

interface FrameGroup {
  timestampUs: number;
  blobs: FusionObservation[];
}

/** Frames bracketing tRef: latest at or before it, earliest at or after it. */
function bracketFrames(
  history: readonly FusionObservation[],
  tRefUs: number,
): { lo: FrameGroup | null; hi: FrameGroup | null } {
  let loUs = -Infinity;
  let hiUs = Infinity;
  for (const o of history) {
    const t = observationTimeUs(o);
    if (t <= tRefUs && t > loUs) loUs = t;
    if (t >= tRefUs && t < hiUs) hiUs = t;
  }
  const group = (us: number): FrameGroup | null => {
    if (!Number.isFinite(us)) return null;
    // Keep the frame's blob order: the Pi sends its best blob first.
    const blobs = history.filter((o) => observationTimeUs(o) === us);
    return { timestampUs: us, blobs };
  };
  return { lo: group(loUs), hi: group(hiUs) };
}

/**
 * Pair every blob of `near` with the closest unused blob of `far` in pixel
 * space. Interpolating across frames is only valid for the same object.
 */
function matchBlobs(
  near: FusionObservation[],
  far: FusionObservation[],
  gatePx: number,
): (FusionObservation | null)[] {
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < near.length; i++) {
    for (let j = 0; j < far.length; j++) {
      const d = Math.hypot(near[i].x - far[j].x, near[i].y - far[j].y);
      if (d <= gatePx) pairs.push({ i, j, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const out: (FusionObservation | null)[] = near.map(() => null);
  const usedFar = new Set<number>();
  for (const p of pairs) {
    if (out[p.i] !== null || usedFar.has(p.j)) continue;
    out[p.i] = far[p.j];
    usedFar.add(p.j);
  }
  return out;
}

/**
 * Every blob of every camera brought to tRef. Blobs of the two frames that
 * bracket tRef are paired by pixel distance and interpolated; a blob with no
 * partner, or a camera with only one side, is held as-is (confidence x0.8)
 * when its frame lies within the window.
 */
export function alignCandidates(
  histories: ReadonlyMap<string, readonly FusionObservation[]>,
  tRefUs: number,
  windowMs: number,
  pairGatePx: number,
): Map<string, FusionObservation[]> {
  const windowUs = windowMs * 1000;
  const out = new Map<string, FusionObservation[]>();

  for (const [cameraId, history] of histories) {
    if (history.length === 0) continue;
    const { lo, hi } = bracketFrames(history, tRefUs);
    const aligned: FusionObservation[] = [];

    if (lo && hi && lo.timestampUs === hi.timestampUs) {
      for (const b of lo.blobs) aligned.push({ ...b });
    } else if (lo && hi) {
      const span = hi.timestampUs - lo.timestampUs;
      const f = (tRefUs - lo.timestampUs) / span;
      const loIsNear = f < 0.5;
      const near = loIsNear ? lo : hi;
      const far = loIsNear ? hi : lo;
      const nearWithin = Math.abs(near.timestampUs - tRefUs) <= windowUs;
      const partners = matchBlobs(near.blobs, far.blobs, pairGatePx);
      near.blobs.forEach((b, i) => {
        const partner = partners[i];
        if (partner) {
          aligned.push(
            loIsNear
              ? lerpObservation(b, partner, f)
              : lerpObservation(partner, b, f),
          );
        } else if (nearWithin) {
          aligned.push({ ...b, confidence: b.confidence * 0.8 });
        }
      });
    } else {
      const only = lo ?? hi;
      if (only && Math.abs(only.timestampUs - tRefUs) <= windowUs) {
        for (const b of only.blobs) {
          aligned.push({ ...b, confidence: b.confidence * 0.8 });
        }
      }
    }

    if (aligned.length > 0) out.set(cameraId, aligned);
  }

  return out;
}

/**
 * Select the nearest captured frame from every camera and preserve every blob
 * emitted for that frame. Raw voxel rendering deliberately keeps all
 * cross-camera combinations; target association happens elsewhere.
 */
export function timeAlignFrameGroups(
  histories: ReadonlyMap<string, readonly FusionObservation[]>,
  tRefUs: number,
  windowMs: number,
): FusionObservation[] {
  const windowUs = windowMs * 1000;
  const aligned: FusionObservation[] = [];

  for (const history of histories.values()) {
    let nearest: FusionObservation | undefined;
    let nearestDeltaUs = Number.POSITIVE_INFINITY;
    for (const observation of history) {
      const deltaUs = Math.abs(observationTimeUs(observation) - tRefUs);
      if (deltaUs < nearestDeltaUs) {
        nearest = observation;
        nearestDeltaUs = deltaUs;
      }
    }
    if (!nearest || nearestDeltaUs > windowUs) continue;

    for (const observation of history) {
      if (
        observation.frameIndex !== nearest.frameIndex ||
        observation.timestampUs !== nearest.timestampUs
      ) {
        continue;
      }
      const copy = { ...observation };
      if (nearestDeltaUs > 0) copy.confidence *= 0.8;
      aligned.push(copy);
    }
  }

  return aligned;
}
