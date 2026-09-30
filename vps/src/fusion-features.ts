/**
 * Fenêtre glissante de détections 2D par caméra, et les mesures qu'en tire le
 * classifieur appris.
 *
 * Portage direct de `window_features()` dans
 * scripts/pavois_extract_features.py : le modèle est entraîné sur ces
 * colonnes-là, dans cet ordre-là, donc toute divergence de calcul se traduit
 * par un modèle qui note autre chose que ce qu'il a appris. Les deux
 * implémentations sont vérifiées l'une contre l'autre dans
 * fusion-features.spec.ts.
 *
 * Toutes les mesures sont SANS ÉCHELLE : vitesses angulaires, fraction de vol
 * stationnaire, rectitude, dynamique de la silhouette. Elles restent valables
 * tant que les extrinsèques du banc ne sont pas calibrées, contrairement à une
 * altitude ou une vitesse en m/s issues de cette géométrie.
 */

/** Ordre imposé par le modèle exporté. Ne pas réordonner. */
export const FEATURE_ORDER = [
  'ang_speed_mean', 'ang_speed_std', 'ang_speed_p95',
  'ang_accel_mean', 'ang_accel_std',
  'turn_rate_mean', 'turn_rate_std',
  'hover_fraction', 'straightness', 'reversals_per_s',
  'vertical_ratio', 'area_cv', 'area_trend', 'fill_mean', 'fill_std',
  'flap_power',
] as const;

export interface DetectionSample {
  timestampUs: number;
  x: number;       // pixels
  y: number;
  area: number;    // pixels²
  fill?: number;   // aire / aire de la boîte, si connue
}

/** Nombre minimum d'échantillons avant qu'une fenêtre ait un sens. */
export const MIN_SAMPLES = 8;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / values.length);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // numpy.percentile par interpolation linéaire, pour coller au Python
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Historique par caméra, borné par une durée plutôt qu'un nombre d'images :
 * une caméra qui perd des images doit produire une fenêtre plus courte, pas
 * une fenêtre qui remonte plus loin dans le temps.
 */
export class DetectionWindow {
  private samples: DetectionSample[] = [];

  constructor(private readonly windowUs = 2_000_000) {}

  push(sample: DetectionSample): void {
    const last = this.samples[this.samples.length - 1];
    // Un horodatage qui recule signifie une source rejouée ou redémarrée :
    // repartir de zéro plutôt que mesurer un saut négatif.
    if (last && sample.timestampUs < last.timestampUs) {
      this.samples = [];
    }
    this.samples.push(sample);
    const cutoff = sample.timestampUs - this.windowUs;
    while (this.samples.length > 0 && this.samples[0].timestampUs < cutoff) {
      this.samples.shift();
    }
  }

  get size(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples = [];
  }

  /** Mesures dans l'ordre de FEATURE_ORDER, ou null si trop peu de données. */
  features(degPerPixel: number): number[] | null {
    return computeFeatures(this.samples, degPerPixel);
  }
}

export function computeFeatures(
  samples: DetectionSample[],
  degPerPixel: number,
): number[] | null {
  if (samples.length < MIN_SAMPLES) {
    return null;
  }
  const t = samples.map((s) => s.timestampUs / 1e6);
  const xs = samples.map((s) => s.x * degPerPixel);
  const ys = samples.map((s) => s.y * degPerPixel);
  const areas = samples.map((s) => s.area);
  const fills = samples.map((s) => s.fill ?? 0);

  const dt: number[] = [];
  const stepX: number[] = [];
  const stepY: number[] = [];
  const dist: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const d = Math.max(t[i] - t[i - 1], 1e-3);
    dt.push(d);
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    stepX.push(dx);
    stepY.push(dy);
    dist.push(Math.hypot(dx, dy));
  }
  const angSpeed = dist.map((d, i) => d / dt[i]);

  const angAccel: number[] = [];
  for (let i = 1; i < angSpeed.length; i += 1) {
    angAccel.push((angSpeed[i] - angSpeed[i - 1]) / dt[i]);
  }
  if (angAccel.length === 0) angAccel.push(0);

  const heading = stepX.map((dx, i) => (Math.atan2(stepY[i], dx) * 180) / Math.PI);
  const turnRate: number[] = [];
  for (let i = 1; i < heading.length; i += 1) {
    let turn = heading[i] - heading[i - 1];
    turn = ((turn + 180) % 360 + 360) % 360 - 180;
    turnRate.push(Math.abs(turn) / dt[i]);
  }
  if (turnRate.length === 0) turnRate.push(0);

  const path = dist.reduce((a, b) => a + b, 0);
  const net = Math.hypot(xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0]);
  const straightness = path > 1e-6 ? net / path : 0;

  let reversals = 0;
  for (let i = 1; i < stepX.length; i += 1) {
    if (stepX[i - 1] * stepX[i] + stepY[i - 1] * stepY[i] < 0) {
      reversals += 1;
    }
  }
  const span = Math.max(t[t.length - 1] - t[0], 1e-3);

  let vert = 0;
  let horiz = 0;
  for (let i = 0; i < stepX.length; i += 1) {
    vert += Math.abs(stepY[i]);
    horiz += Math.abs(stepX[i]);
  }
  const verticalRatio = vert + horiz > 1e-6 ? vert / (vert + horiz) : 0;

  const areaMean = mean(areas);
  const areaCv = areaMean > 1e-6 ? std(areas) / areaMean : 0;

  let areaTrend = 0;
  if (areas.length > 2 && areaMean > 1e-6) {
    // pente des moindres carrés de l'aire dans le temps, normalisée
    const t0 = t[0];
    const tm = mean(t.map((v) => v - t0));
    const am = areaMean;
    let num = 0;
    let den = 0;
    for (let i = 0; i < areas.length; i += 1) {
      const dtv = t[i] - t0 - tm;
      num += dtv * (areas[i] - am);
      den += dtv * dtv;
    }
    areaTrend = den > 1e-12 ? num / den / areaMean : 0;
  }

  // Battement d'ailes : une voilure souple module la silhouette à quelques Hz,
  // une cellule rigide non. Part de puissance entre 2 et 15 Hz.
  let flapPower = 0;
  if (areas.length >= 16 && areaMean > 1e-6) {
    const sorted = [...dt].sort((a, b) => a - b);
    const medianDt = sorted[Math.floor(sorted.length / 2)];
    if (medianDt > 1e-6) {
      const n = areas.length;
      const centred = areas.map((a) => a - areaMean);
      let bandPower = 0;
      let totalPower = 0;
      const bins = Math.floor(n / 2);
      for (let k = 1; k <= bins; k += 1) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i += 1) {
          const angle = (-2 * Math.PI * k * i) / n;
          re += centred[i] * Math.cos(angle);
          im += centred[i] * Math.sin(angle);
        }
        const power = re * re + im * im;
        totalPower += power;
        const freq = k / (n * medianDt);
        if (freq >= 2 && freq <= 15) {
          bandPower += power;
        }
      }
      flapPower = totalPower > 1e-9 ? bandPower / totalPower : 0;
    }
  }

  return [
    finite(mean(angSpeed)),
    finite(std(angSpeed)),
    finite(percentile(angSpeed, 0.95)),
    finite(mean(angAccel.map(Math.abs))),
    finite(std(angAccel)),
    finite(mean(turnRate)),
    finite(std(turnRate)),
    finite(angSpeed.filter((v) => v < 1).length / angSpeed.length),
    finite(straightness),
    finite(reversals / span),
    finite(verticalRatio),
    finite(areaCv),
    finite(areaTrend),
    finite(mean(fills)),
    finite(std(fills)),
    finite(flapPower),
  ];
}
