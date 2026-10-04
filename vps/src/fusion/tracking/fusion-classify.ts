// Scorecard cinématique porté de feature/pattern-matching-v2.
// Heuristique empirique, pas un classifieur visuel / ML.

export type TrackClass = 'drone' | 'airplane' | 'bird' | 'other';

export interface ClassifyInput {
  speedMps: number;
  accelMps2: number;
  altM: number;
  headingChangeDegPerS: number;
  priorAccelMps2?: number;
}

export interface ClassifyResult {
  classification: TrackClass;
  confidence: number;
}

interface Scores {
  airplane: number;
  bird: number;
  drone: number;
  other: number;
}

const VALID_CLASSES: TrackClass[] = ['drone', 'airplane', 'bird', 'other'];

export const DT_MIN_S = 0.001;
export const DT_MAX_S = 60;

const SPEED_AIRPLANE_MIN = 85;
const SPEED_DRONE_FAST_MIN = 45;
const SPEED_MID_MIN = 12;
const SPEED_SLOW_MIN = 5;

const ACCEL_HIGH = 15;
const ACCEL_LOW = 3;
const SPEED_HIGH_FOR_LOW_ACCEL = 50;

const ALT_HIGH = 120;
const ALT_LOW = 60;
const SPEED_BIRD_LOW = 5;
const SPEED_BIRD_HIGH = 25;

const HEADING_CHANGE_HIGH = 90;

const HOVER_SPEED_MAX = 3;
const HOVER_PRIOR_ACCEL_MIN = 10;

export function parseExplicitClass(
  raw: string | undefined,
): TrackClass | undefined {
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  return VALID_CLASSES.find((c) => c === lower);
}

export function isClassifiableDt(dtS: number): boolean {
  return dtS >= DT_MIN_S && dtS <= DT_MAX_S;
}

export function headingDegEnu(ve: number, vn: number): number {
  return ((Math.atan2(vn, ve) * 180) / Math.PI + 360) % 360;
}

export function headingDeltaDeg(fromDeg: number, toDeg: number): number {
  let diff = Math.abs(toDeg - fromDeg);
  if (diff > 180) {
    diff = 360 - diff;
  }
  return diff;
}

export interface SpeedFilter {
  speed?: number;
  accel: number;
}

const SPEED_ALPHA = 0.25;
const SPEED_BETA = 0.2;

export function smoothSpeedAccel(
  filter: SpeedFilter,
  rawSpeed: number,
  dtS: number,
): SpeedFilter {
  if (filter.speed === undefined) {
    return { speed: rawSpeed, accel: 0 };
  }
  const speed = (1 - SPEED_ALPHA) * filter.speed + SPEED_ALPHA * rawSpeed;
  const rawAcc = Math.abs(speed - filter.speed) / dtS;
  const accel = (1 - SPEED_BETA) * filter.accel + SPEED_BETA * rawAcc;
  return { speed, accel };
}

export function classifyKinematics(k: ClassifyInput): ClassifyResult {
  const scores: Scores = {
    airplane: 0,
    bird: 0,
    drone: 0,
    other: 0,
  };
  addSpeedScores(scores, k.speedMps);
  addAccelScores(scores, k.speedMps, k.accelMps2);
  addAltScores(scores, k.speedMps, k.altM);
  addHeadingScores(scores, k.headingChangeDegPerS);
  addHoverScores(scores, k.speedMps, k.priorAccelMps2 ?? 0);
  return pickWinner(scores);
}

function addSpeedScores(scores: Scores, speed: number): void {
  if (speed > SPEED_AIRPLANE_MIN) {
    scores.airplane += 4;
    return;
  }
  if (speed > SPEED_DRONE_FAST_MIN) {
    scores.drone += 3;
    return;
  }
  if (speed > SPEED_MID_MIN) {
    scores.drone += 2;
    scores.bird += 2;
    return;
  }
  if (speed >= SPEED_SLOW_MIN) {
    scores.bird += 3;
    scores.other += 1;
    return;
  }
  scores.other += 4;
  scores.bird -= 2;
}

function addAccelScores(scores: Scores, speed: number, accel: number): void {
  if (accel > ACCEL_HIGH) {
    scores.drone += 3;
    scores.bird += 1;
    scores.airplane -= 3;
    return;
  }
  if (accel < ACCEL_LOW && speed > SPEED_HIGH_FOR_LOW_ACCEL) {
    scores.airplane += 2;
  }
}

function addAltScores(scores: Scores, speed: number, alt: number): void {
  if (alt > ALT_HIGH) {
    scores.airplane += 3;
    scores.bird -= 3;
    scores.other -= 2;
    return;
  }
  if (alt >= ALT_LOW) {
    return;
  }
  if (speed < SPEED_BIRD_LOW) {
    scores.other += 2;
    return;
  }
  if (speed <= SPEED_BIRD_HIGH) {
    scores.bird += 2;
  }
}

function addHeadingScores(scores: Scores, rateDegPerS: number): void {
  if (rateDegPerS <= HEADING_CHANGE_HIGH) {
    return;
  }
  scores.drone += 3;
  scores.bird += 1;
  scores.airplane -= 4;
}

function addHoverScores(
  scores: Scores,
  speed: number,
  priorAccel: number,
): void {
  if (speed >= HOVER_SPEED_MAX) {
    return;
  }
  if (priorAccel > HOVER_PRIOR_ACCEL_MIN) {
    scores.drone += 3;
    return;
  }
  scores.other += 3;
  scores.bird -= 2;
}

function pickWinner(scores: Scores): ClassifyResult {
  const maxScore = Math.max(
    scores.other,
    scores.airplane,
    scores.bird,
    scores.drone,
  );
  let classification: TrackClass = 'drone';
  if (scores.other === maxScore) {
    classification = 'other';
  } else if (scores.airplane === maxScore) {
    classification = 'airplane';
  } else if (scores.bird === maxScore) {
    classification = 'bird';
  }
  return { classification, confidence: confidenceOf(scores) };
}

function confidenceOf(scores: Scores): number {
  const values = [scores.airplane, scores.bird, scores.drone, scores.other];
  values.sort((a, b) => b - a);
  const margin = values[0] - values[1];
  let totalPositive = 0;
  for (const s of values) {
    totalPositive += Math.max(0, s);
  }
  if (totalPositive <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, margin / totalPositive));
}
