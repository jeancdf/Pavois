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

export function timeAlign(
  histories: ReadonlyMap<string, readonly FusionObservation[]>,
  tRefUs: number,
  windowMs: number,
): FusionObservation[] {
  const windowUs = windowMs * 1000;
  const aligned: FusionObservation[] = [];

  for (const hist of histories.values()) {
    if (hist.length === 0) {
      continue;
    }

    let lo: FusionObservation | undefined;
    let hi: FusionObservation | undefined;
    for (const o of hist) {
      const t = observationTimeUs(o);
      if (t <= tRefUs && (lo === undefined || t > observationTimeUs(lo))) {
        lo = o;
      }
      if (t >= tRefUs && (hi === undefined || t < observationTimeUs(hi))) {
        hi = o;
      }
    }

    if (lo !== undefined && hi !== undefined && lo !== hi) {
      const tLo = observationTimeUs(lo);
      const span = observationTimeUs(hi) - tLo;
      const f = span === 0 ? 0 : (tRefUs - tLo) / span;
      aligned.push(lerpObservation(lo, hi, f));
    } else if (lo !== undefined && lo === hi) {
      aligned.push({ ...lo });
    } else if (lo !== undefined && tRefUs - observationTimeUs(lo) <= windowUs) {
      const o = { ...lo };
      o.confidence *= 0.8;
      aligned.push(o);
    } else if (hi !== undefined && observationTimeUs(hi) - tRefUs <= windowUs) {
      const o = { ...hi };
      o.confidence *= 0.8;
      aligned.push(o);
    }
  }

  return aligned;
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
