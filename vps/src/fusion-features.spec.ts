import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeFeatures,
  DetectionWindow,
  FEATURE_ORDER,
  MIN_SAMPLES,
  type DetectionSample,
} from './fusion-features';

/**
 * Le modèle est entraîné en Python sur ces mesures. Si le portage TypeScript
 * calcule ne serait-ce qu'une colonne différemment, le modèle note autre chose
 * que ce qu'il a appris, sans rien planter. Les cas ci-dessous viennent de
 * scripts/pavois_extract_features.py et sont comparés colonne par colonne.
 */
interface Fixture {
  name: string;
  degPerPixel: number;
  samples: DetectionSample[];
  expect: number[];
}

const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fusion-features.fixture.json'), 'utf8'),
) as Fixture[];

describe('computeFeatures', () => {
  it('a des cas de référence', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`reproduit le calcul Python : ${fixture.name}`, () => {
      const got = computeFeatures(fixture.samples, fixture.degPerPixel);
      expect(got).not.toBeNull();
      expect(got).toHaveLength(FEATURE_ORDER.length);
      FEATURE_ORDER.forEach((name, i) => {
        const delta = Math.abs(got![i] - fixture.expect[i]);
        const tolerance = 1e-6 * Math.max(1, Math.abs(fixture.expect[i]));
        expect(
          delta <= tolerance
            ? true
            : `${name}: TypeScript ${got![i]} vs Python ${fixture.expect[i]}`,
        ).toBe(true);
      });
    });
  }

  it('refuse une fenêtre trop courte au lieu d’inventer une mesure', () => {
    const few: DetectionSample[] = Array.from({ length: MIN_SAMPLES - 1 }, (_, i) => ({
      timestampUs: i * 33_000,
      x: 100 + i,
      y: 100,
      area: 500,
    }));
    expect(computeFeatures(few, 0.064)).toBeNull();
  });
});

describe('DetectionWindow', () => {
  const sample = (i: number, t = i * 33_000): DetectionSample => ({
    timestampUs: t,
    x: 100 + i,
    y: 100 + i,
    area: 500,
    fill: 0.5,
  });

  it('ne garde que la durée demandée', () => {
    const w = new DetectionWindow(500_000); // 0,5 s
    for (let i = 0; i < 60; i += 1) {
      w.push(sample(i));
    }
    // 0,5 s à 30 Hz tient environ 16 échantillons, pas 60
    expect(w.size).toBeLessThanOrEqual(17);
    expect(w.size).toBeGreaterThan(10);
  });

  it('repart de zéro si l’horodatage recule', () => {
    const w = new DetectionWindow();
    for (let i = 0; i < 20; i += 1) {
      w.push(sample(i));
    }
    expect(w.size).toBe(20);
    w.push({ timestampUs: 0, x: 0, y: 0, area: 100 });
    expect(w.size).toBe(1);
  });

  it('ne produit rien tant qu’il n’y a pas assez d’échantillons', () => {
    const w = new DetectionWindow();
    w.push(sample(0));
    expect(w.features(0.064)).toBeNull();
    for (let i = 1; i < 20; i += 1) {
      w.push(sample(i));
    }
    expect(w.features(0.064)).not.toBeNull();
  });
});
