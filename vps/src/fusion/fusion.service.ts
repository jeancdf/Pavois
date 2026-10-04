import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createWriteStream, type WriteStream } from 'fs';
import {
  alignCandidates,
  timeAlignFrameGroups,
} from './alignment/fusion-align';
import {
  associateTracks,
  spawnFromLeftovers,
  type AssociationContext,
  type Candidate,
} from './association/fusion-association';
import {
  envInt,
  envNumber,
  trackerConfigFromEnv,
  triangulationConfigFromEnv,
  type FusionTuning,
} from './config/fusion-config';
import type { GeoOrigin } from './geometry/fusion-geo';
import {
  isFiniteNumber,
  latestTimestampUs,
  pruneHistory,
  toTriObs,
} from './observation/fusion-observation';
import {
  betterFuse,
  cameraState,
  needTwoFuse,
  NO_SUBSET,
  toLastFuse,
  toWsUpdates,
  type CameraLastSeen,
} from './reporting/fusion-report';
import { Tracker } from './tracking/fusion-tracker';
import {
  pairIntersections,
  type TriangulateObservation,
  type TriangulationResult,
} from './triangulation/fusion-triangulate';
import {
  FusionCameraState,
  FusionLastFuse,
  FusionObservation,
  FusionRayIntersection,
  FusionSnapshot,
  FusionTrack,
  FusionTrackUpdate,
} from './fusion.types';

export type { FusionTuning } from './config/fusion-config';

// Limite le travail déclenché par un seul ingest quand les données
// arrivent en rafale.
const MAX_TICKS_PER_INGEST = 64;

/**
 * Fusion multi-caméras sur le VPS.
 *
 * La fusion tourne sur une grille de temps fixe (FUSION_INTERVAL_MS). Un
 * tick attend que chaque caméra récemment active ait une image à cet
 * instant ou après, ou que FUSION_LATENCY_MS de données plus récentes
 * soient arrivées. Les images des autres Pi pour le même instant sont alors
 * déjà là : on interpole chaque caméra au lieu d'extrapoler.
 *
 * À chaque tick, les taches sont d'abord attribuées aux pistes existantes,
 * en projetant chaque piste prédite dans chaque caméra. Les taches
 * restantes forment de nouvelles candidates (des paires, complétées par la
 * troisième caméra). Chaque cible est triangulée séparément, et sa
 * covariance est donnée au filtre de Kalman.
 *
 * Ce fichier garde l'état du moteur et l'ordre des étapes. Le détail de
 * chaque étape est dans un dossier à part : config/ (réglages),
 * observation/ (préparation des détections), alignment/ (temps),
 * association/ (quelle tache va avec quelle cible), triangulation/ (calcul
 * du point), tracking/ (suivi) et reporting/ (mise en forme des résultats).
 */
@Injectable()
export class FusionService implements OnModuleDestroy {
  private readonly historyWindowMs = envInt('FUSION_HISTORY_MS', 2000);
  private readonly staleAfterMs = envInt('FUSION_STALE_MS', 2000);
  private readonly maxPerCamera = envInt('FUSION_MAX_PER_CAMERA', 256);
  private readonly fusionWindowMs = envInt('FUSION_WINDOW_MS', 20);
  // Les réglages ci-dessous partent des variables d'environnement, puis
  // peuvent être changés en cours de route par applyTuning().
  // Une fusion par image caméra : les Pi capturent à 30 images/s. À garder
  // égal à la période de capture ; plus long, les pistes sont mises à jour
  // moins souvent qu'elles ne sont vues.
  private intervalMs = envInt('FUSION_INTERVAL_MS', 33);
  private latencyMs = envInt('FUSION_LATENCY_MS', 80);
  private assocGatePx = envNumber('FUSION_ASSOC_GATE_PX', 40);
  private pairGatePx = envNumber('FUSION_PAIR_GATE_PX', 60);
  private maxBlobsPerCamera = envInt('FUSION_MAX_BLOBS_PER_CAMERA', 8);
  private maxTargets = envInt('FUSION_MAX_TARGETS', 8);
  private readonly triCfg = triangulationConfigFromEnv();
  private readonly deques = new Map<string, FusionObservation[]>();
  // Survivant à la purge du deque : âge / active restent lisibles.
  private readonly lastSeen = new Map<string, CameraLastSeen>();
  private lastFuse: FusionLastFuse | null = null;
  private rawIntersections: FusionRayIntersection[] = [];
  // Prochain instant de la grille à fusionner ; null avant la première
  // observation.
  private nextTickUs: number | null = null;
  private readonly tracker = new Tracker(trackerConfigFromEnv());
  private tracks: FusionTrack[] = [];
  private pendingTrackUpdates: FusionTrackUpdate[] = [];
  // Origine ENU figée à la première obs GPS.
  private origin: GeoOrigin | null = null;
  // Enregistrement JSONL de chaque observation, pour le rejeu hors ligne
  // (simulation/fusion-replay).
  private readonly recorder: WriteStream | null = this.openRecorder();

  /**
   * Point d'entrée : reçoit une détection d'un Pi, la range dans la file de
   * sa caméra, supprime les détections trop vieilles, puis lance les ticks
   * de fusion qui sont prêts.
   */
  ingest(obs: FusionObservation, nowMs = Date.now()): void {
    if (!obs.cameraId) {
      return;
    }
    this.recorder?.write(JSON.stringify(obs) + '\n');
    this.captureOrigin(obs);
    const deque = this.deques.get(obs.cameraId) ?? [];
    deque.push(obs);
    this.deques.set(obs.cameraId, deque);
    this.remember(obs);
    for (const cameraId of [...this.deques.keys()]) {
      this.prune(cameraId, nowMs);
    }
    this.updateRawIntersections(obs.timestampUs);
    this.processTicks(obs.timestampUs);
  }

  /**
   * Photo de l'état du moteur : caméras actives, dernier résultat de
   * fusion, croisements bruts et pistes en cours.
   */
  snapshot(nowMs = Date.now()): FusionSnapshot {
    const cameras: FusionCameraState[] = [];
    for (const [cameraId, seen] of this.lastSeen) {
      const detectionCount = this.deques.get(cameraId)?.length ?? 0;
      const state = cameraState(
        cameraId,
        seen,
        detectionCount,
        nowMs,
        this.staleAfterMs,
      );
      if (!state) {
        continue;
      }
      cameras.push(state);
    }
    cameras.sort((a, b) => a.cameraId.localeCompare(b.cameraId));
    let activeCameras = 0;
    for (const camera of cameras) {
      if (camera.active) {
        activeCameras += 1;
      }
    }
    return {
      activeCameras,
      cameraCount: cameras.length,
      historyWindowMs: this.historyWindowMs,
      staleAfterMs: this.staleAfterMs,
      cameras,
      lastFuse: this.lastFuse,
      rawIntersections: this.rawIntersections.slice(),
      tracks: this.tracks.slice(),
    };
  }

  /** Copie de la file d'observations d'une caméra. */
  history(cameraId: string): readonly FusionObservation[] {
    const deque = this.deques.get(cameraId);
    if (!deque) {
      return [];
    }
    return deque.slice();
  }

  // Renvoie les messages track_update (GPS) du dernier tick et vide la file.
  pullTrackUpdates(): FusionTrackUpdate[] {
    const out = this.pendingTrackUpdates;
    this.pendingTrackUpdates = [];
    return out;
  }

  /** Renvoie les réglages actuels. */
  tuning(): FusionTuning {
    const tracker = this.tracker.config();
    return {
      maxResidualPx: this.triCfg.maxResidualPx,
      minParallaxDeg: this.triCfg.minParallaxDeg,
      minRangeM: this.triCfg.minRangeM,
      maxRangeM: this.triCfg.maxRangeM,
      assocGatePx: this.assocGatePx,
      pairGatePx: this.pairGatePx,
      maxBlobsPerCamera: this.maxBlobsPerCamera,
      maxTargets: this.maxTargets,
      intervalMs: this.intervalMs,
      latencyMs: this.latencyMs,
      confirmUpdates: tracker.confirmUpdates,
      maxCoastMs: tracker.maxCoastMs,
      gateChi2: tracker.gateChi2,
      matchDistanceM: tracker.matchDistanceM,
      maxSpeedMps: tracker.maxSpeedMps,
      processNoise: tracker.processNoise,
    };
  }

  /**
   * Change les réglages entre deux ticks. Les pistes en cours sont gardées.
   * L'appelant valide les valeurs ; ce qui n'est pas un nombre est ignoré.
   */
  applyTuning(values: Partial<FusionTuning>): void {
    const next = this.tuning();
    for (const key of Object.keys(next) as (keyof FusionTuning)[]) {
      const value = values[key];
      if (isFiniteNumber(value)) next[key] = value;
    }
    this.triCfg.maxResidualPx = next.maxResidualPx;
    this.triCfg.minParallaxDeg = next.minParallaxDeg;
    this.triCfg.minRangeM = next.minRangeM;
    this.triCfg.maxRangeM = next.maxRangeM;
    this.assocGatePx = next.assocGatePx;
    this.pairGatePx = next.pairGatePx;
    this.maxBlobsPerCamera = next.maxBlobsPerCamera;
    this.maxTargets = next.maxTargets;
    this.intervalMs = next.intervalMs;
    this.latencyMs = next.latencyMs;
    this.tracker.configure({
      confirmUpdates: next.confirmUpdates,
      maxCoastMs: next.maxCoastMs,
      gateChi2: next.gateChi2,
      matchDistanceM: next.matchDistanceM,
      maxSpeedMps: next.maxSpeedMps,
      processNoise: next.processNoise,
    });
  }

  onModuleDestroy(): void {
    this.recorder?.end();
  }

  /**
   * Ouvre le fichier d'enregistrement des observations si
   * FUSION_RECORD_PATH est défini.
   */
  private openRecorder(): WriteStream | null {
    const path = process.env.FUSION_RECORD_PATH;
    if (!path) return null;
    const stream = createWriteStream(path, { flags: 'a' });
    stream.on('error', (err) => {
      console.warn(`[FUSION] enregistrement impossible (${path}) :`, err);
    });
    return stream;
  }

  // Vue de debug du rail : toutes les paires de taches des images les plus
  // proches de la dernière observation, avant tout contrôle. Ce sont des
  // échantillons de géométrie, jamais des pistes.
  private updateRawIntersections(tRefUs: number): void {
    const rawAligned = timeAlignFrameGroups(
      this.deques,
      tRefUs,
      this.fusionWindowMs,
    );
    const rawTriObs: TriangulateObservation[] = [];
    for (const item of rawAligned) {
      const mapped = toTriObs(item, this.origin);
      if (mapped) rawTriObs.push(mapped);
    }
    this.rawIntersections =
      rawTriObs.length >= 2
        ? pairIntersections(
            rawTriObs,
            this.triCfg.maxRangeM,
            this.triCfg.minRangeM,
          ).map((intersection) => ({ ...intersection, timestampUs: tRefUs }))
        : [];
  }

  /**
   * Avance sur la grille de temps et fusionne chaque tick prêt. Un tick est
   * prêt quand toutes les caméras actives l'ont dépassé, ou quand le délai
   * de latence est écoulé.
   */
  private processTicks(firstUs: number): void {
    if (this.deques.size === 0) return;
    const latencyUs = this.latencyMs * 1000;
    const intervalUs = this.intervalMs * 1000;
    let watermark = -Infinity;
    for (const deque of this.deques.values()) {
      watermark = Math.max(watermark, latestTimestampUs(deque));
    }
    let tickUs: number = this.nextTickUs ?? firstUs;
    // Après un long silence, on reprend près des données récentes au lieu
    // de rejouer tous les ticks vides du trou.
    if (watermark - tickUs > this.historyWindowMs * 1000) {
      tickUs = watermark - latencyUs;
    }
    this.nextTickUs = tickUs;
    for (let guard = 0; guard < MAX_TICKS_PER_INGEST; guard++) {
      const late = watermark >= tickUs + latencyUs;
      if (!late && !this.allCovered(tickUs, latencyUs)) return;
      if (!this.fuseTick(tickUs, late)) return;
      tickUs += intervalUs;
      this.nextTickUs = tickUs;
    }
    this.nextTickUs = Math.max(tickUs, watermark - latencyUs);
  }

  // Vrai si chaque caméra récemment active a une image au tick ou après.
  // Une caméra muette depuis plus longtemps que la latence (cible hors de
  // son champ) n'est pas attendue.
  private allCovered(tickUs: number, latencyUs: number): boolean {
    for (const deque of this.deques.values()) {
      const latest = latestTimestampUs(deque);
      if (latest < tickUs - latencyUs) continue;
      if (latest < tickUs) return false;
    }
    return true;
  }

  /**
   * Fait la fusion d'un tick : récupère les taches, met à jour les pistes
   * connues, puis crée les nouvelles cibles. Renvoie false si le tick doit
   * attendre d'autres données (il n'est alors pas consommé).
   */
  private fuseTick(tickUs: number, late: boolean): boolean {
    const cands = this.candidatesAt(tickUs);
    if (cands.size < 2) {
      this.lastFuse = needTwoFuse();
      if (!late) return false;
      this.advanceTracker(tickUs);
      return true;
    }

    const ctx: AssociationContext = {
      tracker: this.tracker,
      triCfg: this.triCfg,
      assocGatePx: this.assocGatePx,
      maxTargets: this.maxTargets,
    };
    const applied: TriangulationResult[] = [];
    associateTracks(
      ctx,
      this.tracker.predictAll(tickUs),
      cands,
      tickUs,
      applied,
    );
    spawnFromLeftovers(ctx, cands, tickUs, applied);

    let best: TriangulationResult | null = null;
    for (const r of applied) {
      if (!best || betterFuse(r, best)) best = r;
    }
    this.lastFuse = best
      ? toLastFuse(best)
      : {
          ...needTwoFuse(),
          rejectReason: NO_SUBSET,
          cameras: [...cands.keys()],
        };
    this.advanceTracker(tickUs);
    return true;
  }

  /**
   * Récupère, pour chaque caméra, ses taches ramenées à l'instant du tick,
   * triées de la plus sûre à la moins sûre et limitées en nombre.
   */
  private candidatesAt(tickUs: number): Map<string, Candidate[]> {
    const aligned = alignCandidates(
      this.deques,
      tickUs,
      this.fusionWindowMs,
      this.pairGatePx,
    );
    const out = new Map<string, Candidate[]>();
    for (const [cameraId, blobs] of aligned) {
      const list: Candidate[] = [];
      for (const obs of blobs) {
        const tri = toTriObs(obs, this.origin);
        if (tri)
          list.push({ cameraId, confidence: obs.confidence, tri, used: false });
      }
      list.sort((a, b) => b.confidence - a.confidence);
      if (list.length > 0)
        out.set(cameraId, list.slice(0, this.maxBlobsPerCamera));
    }
    return out;
  }

  /** Fait avancer le suivi jusqu'au tick et prépare les messages GPS. */
  private advanceTracker(tickUs: number): void {
    this.tracks = this.tracker.tick(tickUs);
    this.pendingTrackUpdates = this.origin
      ? toWsUpdates(this.tracks, this.origin)
      : [];
  }

  /**
   * Fixe l'origine du repère local sur la première observation qui a une
   * position GPS.
   */
  private captureOrigin(obs: FusionObservation): void {
    if (this.origin) {
      return;
    }
    if (
      isFiniteNumber(obs.lat) &&
      isFiniteNumber(obs.lon) &&
      isFiniteNumber(obs.alt)
    ) {
      this.origin = { lat: obs.lat, lon: obs.lon, alt: obs.alt };
      this.tracker.setOriginAlt(this.origin.alt);
    }
  }

  /** Retient la dernière observation de chaque caméra, pour son état. */
  private remember(obs: FusionObservation): void {
    const prev = this.lastSeen.get(obs.cameraId);
    if (prev && obs.receivedAtMs < prev.receivedAtMs) {
      return;
    }
    this.lastSeen.set(obs.cameraId, {
      timestampUs: obs.timestampUs,
      receivedAtMs: obs.receivedAtMs,
      x: obs.x,
      y: obs.y,
      confidence: obs.confidence,
      hasPose: isFiniteNumber(obs.headingDeg),
    });
  }

  /**
   * Supprime les observations trop vieilles d'une caméra et limite la taille
   * de sa file. Une file vide est retirée.
   */
  private prune(cameraId: string, nowMs: number): void {
    const deque = this.deques.get(cameraId);
    if (!deque || deque.length === 0) {
      this.deques.delete(cameraId);
      return;
    }
    const kept = pruneHistory(
      deque,
      nowMs,
      this.historyWindowMs,
      this.maxPerCamera,
    );
    if (kept.length === 0) {
      this.deques.delete(cameraId);
    } else {
      this.deques.set(cameraId, kept);
    }
  }
}
