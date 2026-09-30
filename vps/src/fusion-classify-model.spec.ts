import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyKinematics } from './fusion-classify';
import { DetectionWindow, type DetectionSample } from './fusion-features';
import { TrackModel } from './fusion-model';

/**
 * Le test qui justifie tout ce travail.
 *
 * Le barème de fusion-classify est réglé pour un drone de terrain : plusieurs
 * dizaines de m/s, 60 à 120 m d'altitude. Sur le banc, la cible vole à ~0,2 m/s
 * à 1,5 m, donc elle passe sous TOUS ses seuils et ressort "other" — ce que
 * l'opérateur a constaté sur la carte.
 *
 * Les séquences ci-dessous sont de vraies détections extraites de
 * rec-20260929-192005Z, pas des trajectoires inventées.
 */
interface DroneFixture {
  name: string;
  degPerPixel: number;
  samples: DetectionSample[];
}

const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fusion-drone.fixture.json'), 'utf8'),
) as DroneFixture[];

describe('classification du drone du banc', () => {
  const model = TrackModel.load();

  it('a de vraies séquences de détection', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      expect(f.samples.length).toBeGreaterThanOrEqual(45);
    }
  });

  it('le barème classe le drone du banc en "other" (la panne constatée)', () => {
    // Valeurs mesurées sur le banc : 0,23 m/s à 1,5 m d'altitude.
    const scored = classifyKinematics({
      speedMps: 0.23,
      accelMps2: 0.3,
      altM: 1.5,
      headingChangeDegPerS: 40,
      priorAccelMps2: 0.4,
    });
    expect(scored.classification).toBe('other');
  });

  it('le modèle appris reconnaît le drone sur de vraies détections', () => {
    expect(model).not.toBeNull();
    for (const fixture of fixtures) {
      const window = new DetectionWindow(2_000_000);
      for (const sample of fixture.samples) {
        window.push(sample);
      }
      const features = window.features(fixture.degPerPixel);
      expect(features).not.toBeNull();
      const result = model!.predict(features!);
      expect(`${fixture.name}: ${result.classification}`).toBe(
        `${fixture.name}: drone`,
      );
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });

  it('ne se prononce pas sur une fenêtre trop courte', () => {
    const window = new DetectionWindow();
    for (const sample of fixtures[0].samples.slice(0, 4)) {
      window.push(sample);
    }
    expect(window.features(fixtures[0].degPerPixel)).toBeNull();
  });
});
