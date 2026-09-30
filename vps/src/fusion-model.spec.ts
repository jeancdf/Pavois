import { TrackModel } from './fusion-model';

/**
 * Le risque d'un portage comme celui-ci n'est pas qu'il plante, c'est qu'il
 * donne des probabilités légèrement différentes de scikit-learn et que
 * personne ne le remarque. L'export embarque donc des vecteurs de référence
 * avec la sortie exacte de Python ; on l'exige ici.
 */
describe('TrackModel', () => {
  const model = TrackModel.load();

  it('charge le modèle exporté', () => {
    expect(model).not.toBeNull();
    expect(model!.treeCount).toBeGreaterThan(0);
    expect(model!.featureNames.length).toBeGreaterThan(0);
    expect(model!.classes).toEqual(expect.arrayContaining(['drone']));
  });

  it('reproduit les probabilités de scikit-learn sur les vecteurs de référence', () => {
    const refs = model!.referenceVectors;
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const proba = model!.predictProba(ref.features);
      expect(proba).toHaveLength(ref.proba.length);
      proba.forEach((value, index) => {
        // Même arithmétique des deux côtés : l'écart ne doit venir que de
        // l'arrondi à 6 décimales fait à l'export.
        expect(Math.abs(value - ref.proba[index])).toBeLessThan(1e-5);
      });
      expect(model!.predict(ref.features).classification).toBe(ref.expect);
    }
  });

  it('donne une confiance dans [0,1] et une somme de probabilités de 1', () => {
    for (const ref of model!.referenceVectors) {
      const proba = model!.predictProba(ref.features);
      const sum = proba.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
      const { confidence } = model!.predict(ref.features);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('traite une entrée non finie comme neutre plutôt que de propager NaN', () => {
    const n = model!.featureNames.length;
    const broken = new Array<number>(n).fill(Number.NaN);
    const { classification, confidence } = model!.predict(broken);
    expect(Number.isFinite(confidence)).toBe(true);
    expect(typeof classification).toBe('string');
  });

  it('renvoie null sur un fichier absent au lieu de jeter', () => {
    expect(TrackModel.load('/nonexistent/fusion-model.json')).toBeNull();
  });
});
