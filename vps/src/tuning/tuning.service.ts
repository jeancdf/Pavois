import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CamerasService } from '../cameras/cameras.service';
import { FusionService } from '../fusion/fusion.service';
import {
  BUILTIN_PRESETS,
  DETECTOR_DEFAULTS,
  DETECTOR_PARAMS,
  FUSION_PARAMS,
  checkValues,
  completeDetectorValues,
  detectorSettingsLine,
  keepKnownValues,
  settingsVersion,
  type TuningParam,
  type TuningPreset,
  type TuningValues,
} from './tuning.params';
import type { DetectorReport } from '../udp/udp-config';

/** Ce que le VPS veut pour un détecteur. */
type DetectorWish = { mode: 'file' } | { mode: 'live'; values: TuningValues };

interface ReportedSettings {
  version: number;
  values: TuningValues;
  width: number | null;
  height: number | null;
}

export interface TuningCameraState {
  cameraId: string;
  /** `untouched` : personne n'a réglé ce détecteur, il garde ce qu'il a. */
  mode: 'untouched' | 'file' | 'live';
  wanted: TuningValues | null;
  /** Ce que le détecteur dit appliquer, null tant qu'il ne l'a pas annoncé. */
  reported: TuningValues | null;
  reportedVersion: number | null;
  width: number | null;
  height: number | null;
  /** Le détecteur a confirmé qu'il applique ce qui est voulu. */
  synced: boolean;
}

export interface TuningState {
  type: 'tuning_state';
  params: { detector: TuningParam[]; fusion: TuningParam[] };
  detectorDefaults: TuningValues;
  fusion: { values: TuningValues; defaults: TuningValues };
  cameras: TuningCameraState[];
  presets: TuningPreset[];
  /** Le preset qui correspond exactement à l'état courant, s'il y en a un. */
  activePresetId: string | null;
  /** Faux sans UDP_HMAC_SECRET : les détecteurs refusent alors toute commande. */
  detectorCommands: boolean;
}

const MAX_CUSTOM_PRESETS = 50;
const MAX_PRESET_NAME = 40;

export function fuseBroadcastIntervalMs(): number {
  const value = Number.parseInt(process.env.FUSE_BROADCAST_MS ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : 50;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValues(a: TuningValues, b: TuningValues): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Math.abs(a[key] - b[key]) < 1e-9)
  );
}

function wishVersion(wish: DetectorWish): number {
  return wish.mode === 'file'
    ? 0
    : settingsVersion(detectorSettingsLine(wish.values));
}

/**
 * Réglages à chaud et presets. Le VPS est la référence : un détecteur annonce
 * chaque seconde la version qu'il applique, et reçoit de nouveau la commande
 * tant qu'elle diffère de celle voulue. Un Pi qui redémarre retrouve ainsi ses
 * réglages sans rien écrire sur sa carte.
 */
@Injectable()
export class TuningService {
  private readonly filePath = path.resolve(
    process.env.TUNING_FILE || 'data/tuning.json',
  );
  private readonly detectorCommands = Boolean(process.env.UDP_HMAC_SECRET);
  // Valeurs de démarrage du moteur, lues avant d'appliquer quoi que ce soit.
  private readonly fusionDefaults: TuningValues;
  private fusionOverrides: TuningValues = {};
  private readonly wishes = new Map<string, DetectorWish>();
  private readonly reports = new Map<string, ReportedSettings>();
  private customPresets: TuningPreset[] = [];

  constructor(
    private readonly fusion: FusionService,
    private readonly cameras: CamerasService,
  ) {
    this.fusionDefaults = {
      ...this.fusion.tuning(),
      broadcastMs: fuseBroadcastIntervalMs(),
    };
    this.load();
    this.applyFusion();
  }

  state(): TuningState {
    return {
      type: 'tuning_state',
      params: { detector: DETECTOR_PARAMS, fusion: FUSION_PARAMS },
      detectorDefaults: { ...DETECTOR_DEFAULTS },
      fusion: {
        values: this.fusionValues(),
        defaults: { ...this.fusionDefaults },
      },
      cameras: this.cameraIds().map((cameraId) => this.cameraState(cameraId)),
      presets: this.presets(),
      activePresetId: this.matchingPresetId(),
      detectorCommands: this.detectorCommands,
    };
  }

  broadcastMs(): number {
    return this.fusionValues().broadcastMs;
  }

  setFusion(input: unknown): void {
    const checked = checkValues(FUSION_PARAMS, input);
    if ('error' in checked) throw new BadRequestException(checked.error);
    this.fusionOverrides = { ...this.fusionOverrides, ...checked.values };
    this.applyFusion();
    this.save();
  }

  resetFusion(): void {
    this.fusionOverrides = {};
    this.applyFusion();
    this.save();
  }

  /** Sans liste de caméras : toutes celles connues. */
  setDetector(cameraIds: string[] | undefined, input: unknown): void {
    this.requireDetectorCommands();
    const checked = checkValues(DETECTOR_PARAMS, input);
    if ('error' in checked) throw new BadRequestException(checked.error);
    for (const cameraId of this.targets(cameraIds)) {
      const wish = this.wishes.get(cameraId);
      // On part de ce que le détecteur applique vraiment, pour ne changer
      // que ce qui a été demandé.
      const base =
        wish?.mode === 'live'
          ? wish.values
          : (this.reports.get(cameraId)?.values ?? DETECTOR_DEFAULTS);
      this.wishes.set(cameraId, {
        mode: 'live',
        values: completeDetectorValues({ ...base, ...checked.values }),
      });
    }
    this.save();
  }

  /** Rend la main au fichier de configuration du Pi. */
  resetDetector(cameraIds: string[] | undefined): void {
    this.requireDetectorCommands();
    for (const cameraId of this.targets(cameraIds)) {
      this.wishes.set(cameraId, { mode: 'file' });
    }
    this.save();
  }

  applyPreset(id: string): void {
    const preset = this.presets().find((item) => item.id === id);
    if (!preset) throw new NotFoundException(`Preset inconnu : ${id}`);
    this.fusionOverrides = { ...preset.fusion };
    this.applyFusion();
    // Sans commande possible, seule la partie fusion du preset s'applique.
    if (this.detectorCommands) {
      for (const cameraId of this.cameraIds()) {
        if (preset.detector) {
          this.wishes.set(cameraId, {
            mode: 'live',
            values: completeDetectorValues(preset.detector),
          });
        } else if (this.wishes.has(cameraId)) {
          this.wishes.set(cameraId, { mode: 'file' });
        }
      }
    }
    this.save();
  }

  /** Enregistre un preset ; un preset personnalisé du même nom est remplacé. */
  savePreset(input: unknown): TuningPreset {
    if (!isPlainObject(input)) {
      throw new BadRequestException('Preset invalide');
    }
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > MAX_PRESET_NAME) {
      throw new BadRequestException(
        `Nom de preset invalide : 1 à ${MAX_PRESET_NAME} caractères`,
      );
    }
    if (
      BUILTIN_PRESETS.some(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new BadRequestException(
        `« ${name} » est un preset intégré, choisis un autre nom`,
      );
    }
    let detector: TuningValues | null = null;
    if (input.detector != null) {
      const checked = checkValues(DETECTOR_PARAMS, input.detector);
      if ('error' in checked) throw new BadRequestException(checked.error);
      detector = completeDetectorValues(checked.values);
    }
    const fusion = checkValues(FUSION_PARAMS, input.fusion ?? {});
    if ('error' in fusion) throw new BadRequestException(fusion.error);

    const existing = this.customPresets.find(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (!existing && this.customPresets.length >= MAX_CUSTOM_PRESETS) {
      throw new BadRequestException(
        `Trop de presets (${MAX_CUSTOM_PRESETS} au maximum)`,
      );
    }
    const preset: TuningPreset = {
      id: existing?.id ?? `perso-${Date.now().toString(36)}`,
      name,
      description: '',
      builtin: false,
      detector,
      fusion: fusion.values,
    };
    this.customPresets = existing
      ? this.customPresets.map((item) => (item === existing ? preset : item))
      : [...this.customPresets, preset];
    this.save();
    return preset;
  }

  deletePreset(id: string): void {
    if (BUILTIN_PRESETS.some((preset) => preset.id === id)) {
      throw new BadRequestException('Un preset intégré ne se supprime pas');
    }
    if (!this.customPresets.some((preset) => preset.id === id)) {
      throw new NotFoundException(`Preset inconnu : ${id}`);
    }
    this.customPresets = this.customPresets.filter(
      (preset) => preset.id !== id,
    );
    this.save();
  }

  /** Vrai quand ce que le détecteur annonce a changé (à rediffuser). */
  noteReport(report: DetectorReport): boolean {
    const { width, height, ...rest } = report.values;
    const next: ReportedSettings = {
      version: report.version,
      values: keepKnownValues(DETECTOR_PARAMS, rest),
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
    };
    const previous = this.reports.get(report.cameraId);
    this.reports.set(report.cameraId, next);
    return (
      !previous ||
      previous.version !== next.version ||
      previous.width !== next.width ||
      previous.height !== next.height ||
      !sameValues(previous.values, next.values)
    );
  }

  /**
   * Commande à envoyer au détecteur, ou null s'il applique déjà ce qui est
   * voulu. Sans annonce de sa part on ne sait pas : la commande est renvoyée.
   */
  pendingCommand(cameraId: string): string | null {
    const wish = this.wishes.get(cameraId);
    if (!wish || !this.detectorCommands) return null;
    const version = wishVersion(wish);
    if (this.reports.get(cameraId)?.version === version) return null;
    return wish.mode === 'file'
      ? `set,${cameraId},0`
      : `set,${cameraId},${version},${detectorSettingsLine(wish.values)}`;
  }

  /** Taille d'image annoncée par le détecteur, null tant qu'il ne l'a pas dite. */
  frameSize(cameraId: string): { width: number; height: number } | null {
    const report = this.reports.get(cameraId);
    return report?.width && report.height
      ? { width: report.width, height: report.height }
      : null;
  }

  /** Caméras qui ont une commande en attente. */
  pendingCameraIds(): string[] {
    return this.cameraIds().filter(
      (cameraId) => this.pendingCommand(cameraId) !== null,
    );
  }

  private requireDetectorCommands(): void {
    if (!this.detectorCommands) {
      throw new ServiceUnavailableException(
        "Réglage des détecteurs indisponible : UDP_HMAC_SECRET n'est pas défini, les Pi refuseraient la commande",
      );
    }
  }

  private targets(cameraIds: string[] | undefined): string[] {
    const known = this.cameraIds();
    if (!cameraIds) return known;
    for (const cameraId of cameraIds) {
      if (!known.includes(cameraId)) {
        throw new NotFoundException(`Caméra inconnue : ${cameraId}`);
      }
    }
    return cameraIds;
  }

  private cameraIds(): string[] {
    const ids = this.cameras.list().map((camera) => camera.id);
    const extra = [...this.wishes.keys(), ...this.reports.keys()]
      .filter((id) => !ids.includes(id))
      .sort();
    return [...ids, ...new Set(extra)];
  }

  private cameraState(cameraId: string): TuningCameraState {
    const wish = this.wishes.get(cameraId);
    const report = this.reports.get(cameraId);
    return {
      cameraId,
      mode: wish?.mode ?? 'untouched',
      wanted: wish?.mode === 'live' ? { ...wish.values } : null,
      reported: report ? { ...report.values } : null,
      reportedVersion: report?.version ?? null,
      width: report?.width ?? null,
      height: report?.height ?? null,
      synced: !wish || report?.version === wishVersion(wish),
    };
  }

  private presets(): TuningPreset[] {
    return [...BUILTIN_PRESETS, ...this.customPresets];
  }

  private fusionValues(): TuningValues {
    return { ...this.fusionDefaults, ...this.fusionOverrides };
  }

  private applyFusion(): void {
    this.fusion.applyTuning(this.fusionValues());
  }

  private matchingPresetId(): string | null {
    const fusion = this.fusionValues();
    const ids = this.cameraIds();
    const match = this.presets().find((preset) => {
      if (!sameValues(fusion, { ...this.fusionDefaults, ...preset.fusion })) {
        return false;
      }
      const wanted = preset.detector
        ? completeDetectorValues(preset.detector)
        : null;
      return ids.every((cameraId) => {
        const wish = this.wishes.get(cameraId);
        if (!wanted) return !wish || wish.mode === 'file';
        return wish?.mode === 'live' && sameValues(wish.values, wanted);
      });
    });
    return match?.id ?? null;
  }

  // Un JSON illisible bloque le démarrage : repartir de zéro écraserait les
  // presets enregistrés à la prochaine sauvegarde. Une clé inconnue ou hors
  // bornes (fichier d'une autre version) est simplement ignorée.
  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    let stored: unknown;
    try {
      stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Réglages illisibles (${this.filePath}) : ${String(error)}`,
      );
    }
    if (!isPlainObject(stored)) return;

    this.fusionOverrides = keepKnownValues(FUSION_PARAMS, stored.fusion);
    if (isPlainObject(stored.detectors)) {
      for (const [cameraId, wish] of Object.entries(stored.detectors)) {
        if (!isPlainObject(wish)) continue;
        if (wish.mode === 'file') {
          this.wishes.set(cameraId, { mode: 'file' });
        } else if (wish.mode === 'live') {
          this.wishes.set(cameraId, {
            mode: 'live',
            values: completeDetectorValues(
              keepKnownValues(DETECTOR_PARAMS, wish.values),
            ),
          });
        }
      }
    }
    if (Array.isArray(stored.presets)) {
      for (const preset of stored.presets as unknown[]) {
        if (
          !isPlainObject(preset) ||
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string'
        ) {
          continue;
        }
        this.customPresets.push({
          id: preset.id,
          name: preset.name,
          description: '',
          builtin: false,
          detector: isPlainObject(preset.detector)
            ? completeDetectorValues(
                keepKnownValues(DETECTOR_PARAMS, preset.detector),
              )
            : null,
          fusion: keepKnownValues(FUSION_PARAMS, preset.fusion),
        });
      }
    }
  }

  // Fichier temporaire puis renommage : jamais de fichier à moitié écrit.
  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify(
        {
          fusion: this.fusionOverrides,
          detectors: Object.fromEntries(this.wishes),
          presets: this.customPresets,
        },
        null,
        2,
      ),
    );
    fs.renameSync(tmpPath, this.filePath);
  }
}
