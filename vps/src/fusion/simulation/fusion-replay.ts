// Rejeu hors ligne d'une session de fusion enregistrée (FUSION_RECORD_PATH,
// une FusionObservation par ligne) dans FusionService, avec les réglages
// d'environnement actuels. Utilisation, après `npm run build` :
//
//   FUSION_MAX_RESIDUAL_PX=25 \
//     node dist/fusion/simulation/fusion-replay.js session.jsonl \
//     [--truth x,y,z] [--json]
//
// --truth est une cible fixe dans le repère de la fusion (par exemple le
// repère du rail), utilisée pour calculer les erreurs.
import { readFileSync } from 'fs';
import { FusionService } from '../fusion.service';
import type { FusionObservation } from '../fusion.types';

/** Résumé d'un rejeu : nombre de fusions, de pistes, et erreurs. */
export interface ReplaySummary {
  observations: number;
  cameras: string[];
  fuses: number;
  fusesOk: number;
  meanResidualPx: number | null;
  trackIds: number[];
  trackPoints: number;
  // Seulement avec un point de vérité.
  fuseRmseM: number | null;
  trackRmseM: number | null;
}

type Vec = { x: number; y: number; z: number };

/**
 * Lit un enregistrement (une observation JSON par ligne) et le trie par
 * heure de réception.
 */
export function parseRecording(text: string): FusionObservation[] {
  const out: FusionObservation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obs = JSON.parse(line) as FusionObservation;
      if (obs && typeof obs.cameraId === 'string') out.push(obs);
    } catch {
      // Une dernière ligne coupée (enregistreur arrêté net) est normale.
    }
  }
  out.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  return out;
}

/**
 * Rejoue les observations dans le moteur et résume le résultat. Avec un
 * point de vérité, calcule aussi l'erreur des fusions et des pistes.
 */
export function replay(
  observations: FusionObservation[],
  truth: Vec | null = null,
  service = new FusionService(),
): ReplaySummary {
  const dist = (p: Vec) =>
    truth ? Math.hypot(p.x - truth.x, p.y - truth.y, p.z - truth.z) : 0;
  let lastFuse: unknown = null;
  let fuses = 0;
  let fusesOk = 0;
  let residualSum = 0;
  let residualN = 0;
  let fuseSq = 0;
  const seenPoints = new Set<string>();
  const ids = new Set<number>();
  let trackSq = 0;

  for (const obs of observations) {
    service.ingest(obs, obs.receivedAtMs);
    const snap = service.snapshot(obs.receivedAtMs);
    if (snap.lastFuse && snap.lastFuse !== lastFuse) {
      lastFuse = snap.lastFuse;
      fuses += 1;
      if (snap.lastFuse.ok && snap.lastFuse.point) {
        fusesOk += 1;
        if (snap.lastFuse.residualPx != null) {
          residualSum += snap.lastFuse.residualPx;
          residualN += 1;
        }
        fuseSq += dist(snap.lastFuse.point) ** 2;
      }
    }
    for (const t of snap.tracks) {
      const key = `${t.objectId}:${t.timestampUs}`;
      if (seenPoints.has(key)) continue;
      seenPoints.add(key);
      ids.add(t.objectId);
      trackSq += dist(t) ** 2;
    }
  }

  return {
    observations: observations.length,
    cameras: [...new Set(observations.map((o) => o.cameraId))].sort(),
    fuses,
    fusesOk,
    meanResidualPx: residualN ? residualSum / residualN : null,
    trackIds: [...ids].sort((a, b) => a - b),
    trackPoints: seenPoints.size,
    fuseRmseM: truth && fusesOk ? Math.sqrt(fuseSq / fusesOk) : null,
    trackRmseM:
      truth && seenPoints.size ? Math.sqrt(trackSq / seenPoints.size) : null,
  };
}

/** Lit l'argument --truth au format x,y,z. */
function parseTruth(raw: string | undefined): Vec | null {
  if (!raw) return null;
  const [x, y, z] = raw.split(',').map(Number);
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error(`--truth attend x,y,z, reçu "${raw}"`);
  }
  return { x, y, z };
}

/** Programme en ligne de commande : lit le fichier, rejoue, affiche. */
function main(argv: string[]): void {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error(
      'usage: node dist/fusion-replay.js <session.jsonl> [--truth x,y,z] [--json]',
    );
    process.exitCode = 2;
    return;
  }
  const truthIdx = argv.indexOf('--truth');
  const truth = parseTruth(truthIdx >= 0 ? argv[truthIdx + 1] : undefined);
  const summary = replay(parseRecording(readFileSync(file, 'utf8')), truth);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const f = (v: number | null, unit: string) =>
    v == null ? '-' : `${v.toFixed(3)} ${unit}`;
  console.log(
    [
      `observations   ${summary.observations} (${summary.cameras.join(', ')})`,
      `fusions        ${summary.fusesOk} ok / ${summary.fuses}`,
      `résidu moyen   ${f(summary.meanResidualPx, 'px')}`,
      `pistes         ${summary.trackIds.length} id(s), ${summary.trackPoints} points`,
      `RMSE fusion    ${f(summary.fuseRmseM, 'm')}`,
      `RMSE piste     ${f(summary.trackRmseM, 'm')}`,
    ].join('\n'),
  );
}

if (require.main === module) {
  main(process.argv.slice(2));
}
