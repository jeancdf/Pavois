/**
 * Classifieur appris, exporté depuis scikit-learn par
 * scripts/pavois_export_model.py, évalué ici sans dépendance native.
 *
 * Pourquoi une forêt en JSON plutôt qu'ONNX ou un service à côté : le vps
 * tourne dans un conteneur durci en lecture seule. Marcher quelques centaines
 * de nœuds par piste coûte des microsecondes et n'ajoute ni binaire natif ni
 * processus à surveiller.
 *
 * Ce module ne fait que l'arithmétique. Le choix d'utiliser ou non le modèle,
 * et le repli sur le barème de `fusion-classify.ts`, sont dans
 * `fusion-tracker.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TrackClass } from './fusion-classify';

interface ExportedTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[][];
}

export interface ExportedForest {
  format: string;
  features: string[];
  classes: string[];
  synthetic_classes?: string[];
  trained_on?: Record<string, number>;
  scaler: { mean: number[]; scale: number[] };
  trees: ExportedTree[];
  reference?: { features: number[]; expect: string; proba: number[] }[];
}

export interface ModelResult {
  classification: TrackClass;
  confidence: number;
}

const VALID: TrackClass[] = ['drone', 'airplane', 'bird', 'other'];

export class TrackModel {
  private constructor(private readonly forest: ExportedForest) {}

  /** Charge le modèle, ou renvoie null si absent/illisible : le vps doit
   *  démarrer et retomber sur le barème plutôt que refuser de servir. */
  static load(path?: string): TrackModel | null {
    // Nom volontairement distinct du module : `moduleFileExtensions` place
    // `json` avant `ts`, donc un `fusion-model.json` à côté de
    // `fusion-model.ts` serait résolu à la place du module.
    const file = path ?? join(__dirname, 'fusion-model.data.json');
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as ExportedForest;
      if (parsed.format !== 'pavois-forest-1') {
        return null;
      }
      if (
        !Array.isArray(parsed.trees) ||
        parsed.trees.length === 0 ||
        parsed.scaler.mean.length !== parsed.features.length
      ) {
        return null;
      }
      return new TrackModel(parsed);
    } catch {
      return null;
    }
  }

  get featureNames(): string[] {
    return this.forest.features;
  }

  get classes(): string[] {
    return this.forest.classes;
  }

  get syntheticClasses(): string[] {
    return this.forest.synthetic_classes ?? [];
  }

  get treeCount(): number {
    return this.forest.trees.length;
  }

  get referenceVectors() {
    return this.forest.reference ?? [];
  }

  /** Probabilité par classe, dans l'ordre de `classes`. */
  predictProba(features: number[]): number[] {
    const { mean, scale } = this.forest.scaler;
    const n = this.forest.features.length;
    const x = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const raw = Number.isFinite(features[i]) ? features[i] : 0;
      const denom = scale[i] === 0 ? 1 : scale[i];
      x[i] = (raw - mean[i]) / denom;
    }

    const totals = new Array<number>(this.forest.classes.length).fill(0);
    for (const tree of this.forest.trees) {
      let node = 0;
      // -1 marks a leaf on both sides in scikit-learn's flat representation.
      while (tree.left[node] !== -1) {
        node = x[tree.feature[node]] <= tree.threshold[node]
          ? tree.left[node]
          : tree.right[node];
      }
      const leaf = tree.value[node];
      for (let c = 0; c < totals.length; c += 1) {
        totals[c] += leaf[c];
      }
    }
    const trees = this.forest.trees.length;
    return totals.map((v) => v / trees);
  }

  predict(features: number[]): ModelResult {
    const proba = this.predictProba(features);
    let best = 0;
    for (let i = 1; i < proba.length; i += 1) {
      if (proba[i] > proba[best]) {
        best = i;
      }
    }
    const name = this.forest.classes[best];
    const classification = (VALID as string[]).includes(name)
      ? (name as TrackClass)
      : 'other';
    return { classification, confidence: proba[best] };
  }
}
