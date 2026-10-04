// Suivi de plusieurs cibles par filtres de Kalman à vitesse constante.
// Portage de tracker.cpp de pavois++, avec en plus : un seuil d'association
// en distance de Mahalanobis, une covariance par mesure et la reprise
// d'identité d'une piste perdue.
import { KalmanCV } from './fusion-kalman';
import type { Vec3 } from '../geometry/fusion-geo';
import type { FusionTrack } from '../fusion.types';
import {
  classifyKinematics,
  headingDegEnu,
  headingDeltaDeg,
  isClassifiableDt,
  smoothSpeedAccel,
} from './fusion-classify';

/** Réglages du suivi de pistes. */
export interface TrackerConfig {
  // Seuil en mètres pour les pistes provisoires (vitesse inconnue), et marge
  // ajoutée à la distance physiquement atteignable pour toutes les pistes.
  matchDistanceM: number;
  processNoise: number;
  measNoise: number;
  confirmUpdates: number;
  maxCoastMs: number;
  maxSpeedMps: number;
  // Seuil en distance de Mahalanobis au carré pour les pistes confirmées
  // (loi du chi² à 3 degrés de liberté, 99 %).
  gateChi2: number;
  // Incertitude minimale ajoutée à la covariance d'une triangulation.
  measFloorM: number;
}

// Valeurs par défaut de la structure TrackerConfig du C++ (tests
// unitaires). Les valeurs par défaut de FusionService suivent AppConfig
// (process 200, meas 2.5).
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  matchDistanceM: 6,
  processNoise: 4,
  measNoise: 1.5,
  confirmUpdates: 3,
  maxCoastMs: 1200,
  maxSpeedMps: 120,
  gateChi2: 11.34,
  measFloorM: 0.05,
};

const EMIT_GRACE_MS = 220;

/** Une piste prédite à un instant donné, avec son incertitude. */
export interface PredictedTrack {
  id: number;
  position: Vec3;
  // Covariance 3x3 de la position à l'instant prédit, ligne par ligne.
  covariance: number[];
  confirmed: boolean;
  hits: number;
  // A déjà reçu une mesure à cet instant.
  updated: boolean;
}

interface Track {
  id: number;
  kf: KalmanCV;
  lastUpdateUs: number;
  createdUs: number;
  hits: number;
  confirmed: boolean;
  confidence: number;
  cameras: string[];
  classification: string;
  lastKineUs: number;
  lastSpeed?: number;
  lastHeading?: number;
  lastAccel: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Gère toutes les pistes : création, mise à jour, confirmation, oubli. */
export class Tracker {
  private readonly cfg: TrackerConfig;
  private readonly tracks: Track[] = [];
  private nextId = 1;
  // Altitude GPS de l'origine du repère local ; z est relatif, donc
  // altitude = origine + z.
  private originAltM = 0;

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER_CONFIG, ...cfg };
  }

  setOriginAlt(altM: number): void {
    this.originAltM = altM;
  }

  config(): TrackerConfig {
    return { ...this.cfg };
  }

  /** Change les réglages sans toucher aux pistes en cours. */
  configure(cfg: Partial<TrackerConfig>): void {
    Object.assign(this.cfg, cfg);
  }

  /**
   * Prédit où sera chaque piste à l'instant tsUs. Les pistes confirmées
   * viennent en premier, puis celles qui ont reçu le plus de mesures.
   */
  predictAll(tsUs: number): PredictedTrack[] {
    const out: PredictedTrack[] = [];
    for (const t of this.tracks) {
      const probe = this.cloneTrack(t);
      this.predictTo(probe, tsUs);
      const p = probe.kf.position();
      out.push({
        id: t.id,
        position: { x: p[0], y: p[1], z: p[2] },
        covariance: probe.kf.positionCovariance(),
        confirmed: t.confirmed,
        hits: t.hits,
        updated: t.lastUpdateUs >= tsUs,
      });
    }
    out.sort((a, b) =>
      a.confirmed !== b.confirmed ? (a.confirmed ? -1 : 1) : b.hits - a.hits,
    );
    return out;
  }

  /**
   * Met à jour la piste `id` avec une mesure déjà associée à elle (par
   * exemple en pixels). Le seuil 3D s'applique quand même : renvoie false si
   * la mesure est refusée, pour que l'appelant puisse la réutiliser.
   */
  updateTrack(
    id: number,
    z: Vec3,
    tsUs: number,
    measConf: number,
    cameras: string[],
    measCov?: number[] | null,
  ): boolean {
    const t = this.tracks.find((track) => track.id === id);
    if (!t || t.lastUpdateUs >= tsUs) return false;
    const R = this.measCov(measCov);
    const zv = [z.x, z.y, z.z];
    if (this.gate(t, zv, tsUs, R) === null) return false;
    this.predictTo(t, tsUs);
    this.commit(t, zv, measConf, cameras, R);
    return true;
  }

  /**
   * Donne une mesure à la piste la plus proche (en distance de
   * Mahalanobis). Si aucune piste ne convient, crée une nouvelle piste.
   */
  update(
    z: Vec3,
    tsUs: number,
    measConf: number,
    cameras: string[],
    measCov?: number[] | null,
  ): FusionTrack | null {
    const R = this.measCov(measCov);
    const zv = [z.x, z.y, z.z];
    let best: Track | null = null;
    let bestD = Infinity;
    for (const t of this.tracks) {
      // Une seule mesure par piste et par instant.
      if (t.lastUpdateUs >= tsUs) continue;
      const d = this.gate(t, zv, tsUs, R);
      if (d !== null && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) {
      this.spawn(zv, tsUs, measConf, cameras, R);
      return null;
    }
    this.predictTo(best, tsUs);
    return this.commit(best, zv, measConf, cameras, R);
  }

  /**
   * Renvoie les pistes confirmées et récemment mises à jour, à l'instant
   * nowUs, puis oublie celles qui sont muettes depuis trop longtemps.
   */
  tick(nowUs: number): FusionTrack[] {
    const alive: FusionTrack[] = [];
    for (const t of this.tracks) {
      const sinceMs =
        nowUs > t.lastUpdateUs ? (nowUs - t.lastUpdateUs) / 1000 : 0;
      if (!t.confirmed) continue;
      if (sinceMs > EMIT_GRACE_MS) continue;
      const probe = this.cloneTrack(t);
      this.predictTo(probe, nowUs);
      if (probe.kf.speed() <= this.cfg.maxSpeedMps) {
        alive.push(this.makeUpdate(probe));
      }
    }
    this.dropCoasted(nowUs);
    return alive;
  }

  /**
   * Coût d'association de la mesure zv avec la piste t, ou null si la
   * mesure est hors seuil. Le coût est la distance de Mahalanobis au carré,
   * limitée par la distance que la cible a pu parcourir. Une piste
   * provisoire démarre avec une vitesse très incertaine (maxSpeed / 3, au
   * moins 10 m/s) : sa deuxième mesure passe facilement, mais la troisième
   * doit déjà coller à une vitesse constante. Des paires de taches au
   * hasard s'enchaînent rarement trois fois. Elle garde aussi le seuil en
   * mètres.
   */
  private gate(
    t: Track,
    zv: number[],
    tsUs: number,
    R: number[] | undefined,
  ): number | null {
    const probe = this.cloneTrack(t);
    this.predictTo(probe, tsUs);
    const p = probe.kf.position();
    const euclid = Math.hypot(p[0] - zv[0], p[1] - zv[1], p[2] - zv[2]);
    const dtS = Math.max(0, (tsUs - t.lastUpdateUs) / 1e6);
    const reachable = this.cfg.maxSpeedMps * dtS + this.cfg.matchDistanceM;
    if (euclid > reachable) return null;
    const d2 = probe.kf.gatingDistance(zv, R);
    if (d2 > this.cfg.gateChi2) return null;
    return t.confirmed || euclid <= this.cfg.matchDistanceM ? d2 : null;
  }

  /**
   * Vérifie la covariance d'une mesure et lui ajoute une incertitude
   * minimale. Renvoie undefined si elle est inutilisable.
   */
  private measCov(cov?: number[] | null): number[] | undefined {
    if (!cov || cov.length !== 9 || !cov.every(Number.isFinite)) {
      return undefined;
    }
    const floor = this.cfg.measFloorM * this.cfg.measFloorM;
    const out = cov.slice();
    out[0] += floor;
    out[4] += floor;
    out[8] += floor;
    return out;
  }

  /** Crée une nouvelle piste provisoire à partir d'une mesure. */
  private spawn(
    zv: number[],
    tsUs: number,
    measConf: number,
    cameras: string[],
    R: number[] | undefined,
  ): void {
    const t: Track = {
      id: this.nextId++,
      kf: new KalmanCV(),
      lastUpdateUs: tsUs,
      createdUs: tsUs,
      hits: 1,
      confirmed: false,
      confidence: measConf * 0.5,
      cameras: cameras.slice(),
      classification: 'other',
      lastKineUs: tsUs,
      lastAccel: 0,
    };
    // On part de la covariance de la triangulation quand elle existe.
    // L'incertitude sur la vitesse est assez large pour toute cible
    // plausible, et jamais sous les 10 m/s d'origine, pour que l'estimation
    // de vitesse réagisse vite.
    const speedSigma = Math.max(10, this.cfg.maxSpeedMps / 3);
    t.kf.init(
      3,
      zv,
      this.cfg.processNoise,
      this.cfg.measNoise,
      R,
      speedSigma * speedSigma,
    );
    this.tracks.push(t);
  }

  /**
   * Applique une mesure à une piste : corrige le Kalman, met à jour la
   * confiance, et confirme la piste quand elle a reçu assez de mesures.
   */
  private commit(
    best: Track,
    zv: number[],
    measConf: number,
    cameras: string[],
    R: number[] | undefined,
  ): FusionTrack | null {
    best.kf.update(zv, R);
    best.hits += 1;
    best.cameras = cameras.slice();
    best.confidence = clamp(
      0.6 * best.confidence + 0.4 * measConf + 0.02 * Math.min(10, best.hits),
      0,
      0.99,
    );
    if (
      !best.confirmed &&
      best.hits >= this.cfg.confirmUpdates &&
      best.kf.speed() <= this.cfg.maxSpeedMps
    ) {
      best.confirmed = true;
      this.reidentify(best);
    }
    this.applyKineClass(best);
    return best.confirmed ? this.makeUpdate(best) : null;
  }

  /**
   * Une piste tout juste confirmée, apparue là où une piste confirmée a été
   * perdue, reprend son identifiant : un trou ne change pas l'identité.
   * Remplace l'ancienne réinitialisation du Kalman sur place, qui laissait
   * un seul point isolé téléporter une piste vivante.
   */
  private reidentify(fresh: Track): void {
    const recoveryGate = Math.max(this.cfg.matchDistanceM * 3, 12);
    const p = fresh.kf.position();
    let lost: Track | null = null;
    let lostD = recoveryGate;
    for (const t of this.tracks) {
      if (t === fresh || !t.confirmed) continue;
      // Seulement une piste devenue muette avant la naissance de la nouvelle.
      if (t.lastUpdateUs >= fresh.createdUs) continue;
      const probe = this.cloneTrack(t);
      this.predictTo(probe, fresh.lastUpdateUs);
      const q = probe.kf.position();
      const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (d <= lostD) {
        lostD = d;
        lost = t;
      }
    }
    if (!lost) return;
    fresh.id = lost.id;
    this.tracks.splice(this.tracks.indexOf(lost), 1);
  }

  /** Supprime les pistes sans mesure depuis plus de maxCoastMs. */
  private dropCoasted(nowUs: number): void {
    const kept: Track[] = [];
    for (const t of this.tracks) {
      const coastMs =
        nowUs > t.lastUpdateUs ? (nowUs - t.lastUpdateUs) / 1000 : 0;
      if (coastMs <= this.cfg.maxCoastMs) kept.push(t);
    }
    this.tracks.length = 0;
    this.tracks.push(...kept);
  }

  /** Fait avancer le Kalman d'une piste jusqu'à l'instant nowUs. */
  private predictTo(t: Track, nowUs: number): void {
    if (nowUs <= t.lastUpdateUs) return;
    const dt = (nowUs - t.lastUpdateUs) / 1e6;
    t.kf.predict(dt);
    t.lastUpdateUs = nowUs;
  }

  /** Met une piste au format envoyé à l'interface. */
  private makeUpdate(t: Track): FusionTrack {
    const p = t.kf.position();
    return {
      objectId: t.id,
      timestampUs: t.lastUpdateUs,
      x: p[0],
      y: p[1],
      z: p[2],
      confidence: t.confidence,
      cameras: t.cameras.slice(),
      classification: t.classification || 'other',
    };
  }

  /** Copie une piste, pour prédire sans modifier l'originale. */
  private cloneTrack(t: Track): Track {
    return {
      id: t.id,
      kf: t.kf.clone(),
      lastUpdateUs: t.lastUpdateUs,
      createdUs: t.createdUs,
      hits: t.hits,
      confirmed: t.confirmed,
      confidence: t.confidence,
      cameras: t.cameras.slice(),
      classification: t.classification,
      lastKineUs: t.lastKineUs,
      lastSpeed: t.lastSpeed,
      lastHeading: t.lastHeading,
      lastAccel: t.lastAccel,
    };
  }

  // Classe la piste selon son mouvement (vitesse, accélération, direction
  // du Kalman) et son altitude GPS = origine + z.
  private applyKineClass(t: Track): void {
    const dtS = (t.lastUpdateUs - t.lastKineUs) / 1e6;
    t.lastKineUs = t.lastUpdateUs;
    if (!isClassifiableDt(dtS)) {
      return;
    }
    const vel = t.kf.velocity();
    const rawSpeed = t.kf.speed();
    const heading = headingDegEnu(vel[0], vel[1]);
    const filtered = smoothSpeedAccel(
      { speed: t.lastSpeed, accel: t.lastAccel },
      rawSpeed,
      dtS,
    );
    const speed = filtered.speed ?? rawSpeed;
    const accel = filtered.accel;
    let headingRate = 0;
    if (t.lastHeading !== undefined && speed >= 0.5) {
      headingRate = headingDeltaDeg(t.lastHeading, heading) / dtS;
    }
    const pos = t.kf.position();
    const scored = classifyKinematics({
      speedMps: speed,
      accelMps2: accel,
      altM: this.originAltM + pos[2],
      headingChangeDegPerS: headingRate,
      priorAccelMps2: t.lastAccel,
    });
    t.classification = scored.classification;
    t.lastSpeed = speed;
    t.lastAccel = accel;
    if (speed >= 0.5) {
      t.lastHeading = heading;
    }
  }
}
