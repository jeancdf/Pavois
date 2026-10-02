import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NotificationService } from '../../services/notification.service';
import { RealtimeService } from '../../services/realtime.service';
import { TuningService } from '../../services/tuning.service';
import type {
  TuningCameraState,
  TuningParam,
  TuningState,
  TuningValues,
} from '../../models/tuning.model';

type Scope = 'detector' | 'fusion';

interface ParamGroup {
  name: string;
  params: TuningParam[];
}

export const ALL_CAMERAS = 'all';
// Un curseur que l'on fait glisser n'envoie qu'une requête par tranche de 120 ms.
const SEND_DELAY_MS = 120;
const DELETE_CONFIRM_MS = 4000;
// Un détecteur envoie ses statistiques chaque seconde.
const ONLINE_WINDOW_MS = 4000;

function groupParams(params: TuningParam[]): ParamGroup[] {
  const groups: ParamGroup[] = [];
  for (const param of params) {
    const group = groups.find((item) => item.name === param.group);
    if (group) group.params.push(param);
    else groups.push({ name: param.group, params: [param] });
  }
  return groups;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inattendue';
}

@Component({
  selector: 'app-tuning-panel',
  templateUrl: './tuning-panel.html',
  styleUrl: './tuning-panel.css',
})
export class TuningPanel implements OnInit, OnDestroy {
  private readonly api = inject(TuningService);
  private readonly notifications = inject(NotificationService);
  private readonly realtime = inject(RealtimeService);

  readonly allCameras = ALL_CAMERAS;
  readonly state = this.realtime.tuning;
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  // Cible des réglages de détection : toutes les caméras, ou une seule.
  readonly target = signal<string>(ALL_CAMERAS);
  readonly presetName = signal('');
  readonly confirmingDelete = signal<string | null>(null);

  readonly detectorGroups = computed(() => groupParams(this.state()?.params.detector ?? []));
  readonly fusionGroups = computed(() => groupParams(this.state()?.params.fusion ?? []));
  readonly activePreset = computed(() => {
    const state = this.state();
    return state?.presets.find((preset) => preset.id === state.activePresetId) ?? null;
  });
  readonly targetCameras = computed<TuningCameraState[]>(() => {
    const cameras = this.state()?.cameras ?? [];
    const target = this.target();
    return target === ALL_CAMERAS
      ? cameras
      : cameras.filter((camera) => camera.cameraId === target);
  });

  // Valeur qu'un curseur vient de prendre : affichée tant que le backend n'a
  // pas répondu, sinon le curseur reculerait sous le doigt.
  private readonly drafts = signal<Record<string, number>>({});
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly edits = new Map<string, number>();
  private deleteTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), 1000);

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loadError.set(null);
    try {
      await this.api.refresh();
    } catch (error) {
      this.loadError.set(messageOf(error));
    }
  }

  selectTarget(target: string): void {
    this.target.set(target);
    // Les brouillons valaient pour l'ancienne cible.
    this.drafts.update((drafts) =>
      Object.fromEntries(Object.entries(drafts).filter(([id]) => !id.startsWith('detector:'))),
    );
  }

  detectorValue(param: TuningParam): number {
    const draft = this.drafts()[`detector:${param.key}`];
    if (draft !== undefined) return draft;
    const state = this.state();
    if (!state) return param.min;
    const camera = this.targetCameras()[0];
    return camera ? effectiveValue(state, camera, param.key) : state.detectorDefaults[param.key];
  }

  /** « jean 14 · tanel 9 » quand les caméras visées n'ont pas la même valeur. */
  mixedValues(param: TuningParam): string | null {
    const state = this.state();
    const cameras = this.targetCameras();
    if (!state || cameras.length < 2) return null;
    const values = cameras.map((camera) => effectiveValue(state, camera, param.key));
    if (values.every((value) => value === values[0])) return null;
    return cameras.map((camera, index) => `${camera.cameraId} ${values[index]}`).join(' · ');
  }

  /**
   * Ce que les Pi visés appliquent vraiment, pour un réglage de capture dont
   * l'affichage dit autre chose : 0 laisse chaque Pi sur son fichier, et une
   * caméra qui refuse une taille revient à l'ancienne.
   */
  actualNote(param: TuningParam): string | null {
    if (!param.choices && param.zeroLabel === undefined) return null;
    const shown = this.detectorValue(param);
    const cameras = this.targetCameras().filter(
      (camera) => camera.reported?.[param.key] !== undefined,
    );
    if (cameras.length === 0) return null;
    const actual = cameras.map((camera) => camera.reported![param.key]);
    if (actual.every((value) => value === shown)) return null;
    const prefix = shown === 0 && param.zeroLabel ? param.zeroLabel : 'Pi';
    if (actual.every((value) => value === actual[0])) {
      return `${prefix} : ${formatValue(param, actual[0])}`;
    }
    const each = cameras.map(
      (camera, index) => `${camera.cameraId} ${formatValue(param, actual[index])}`,
    );
    return `${prefix} : ${each.join(' · ')}`;
  }

  fusionValue(param: TuningParam): number {
    const draft = this.drafts()[`fusion:${param.key}`];
    if (draft !== undefined) return draft;
    return this.state()?.fusion.values[param.key] ?? param.min;
  }

  /** Valeur de démarrage du VPS quand le réglage s'en écarte, sinon null. */
  fusionDefault(param: TuningParam): number | null {
    const fusion = this.state()?.fusion;
    if (!fusion) return null;
    const start = fusion.defaults[param.key];
    return fusion.values[param.key] === start ? null : start;
  }

  /**
   * Un détecteur arrêté garde son dernier état côté backend : seule la
   * fraîcheur de ses statistiques dit qu'il tourne encore.
   */
  syncStatus(camera: TuningCameraState): { label: string; tone: 'ok' | 'wait' | 'off' } {
    const stats = this.realtime.statsOf(camera.cameraId);
    if (!stats || this.now() - stats.receivedAt > ONLINE_WINDOW_MS) {
      return { label: 'hors ligne', tone: 'off' };
    }
    // Il tourne mais n'annonce pas ses réglages : version sans réglage à chaud.
    if (!camera.reported) return { label: 'détecteur à mettre à jour', tone: 'wait' };
    if (!camera.synced) return { label: 'en attente', tone: 'wait' };
    return camera.mode === 'live'
      ? { label: 'réglé', tone: 'ok' }
      : { label: 'config du Pi', tone: 'ok' };
  }

  /** Curseur en mouvement : affichage immédiat, envoi regroupé. */
  slide(scope: Scope, param: TuningParam, event: Event): void {
    this.edit(scope, param, event, SEND_DELAY_MS);
  }

  /** Curseur relâché ou valeur saisie : envoi immédiat. */
  commit(scope: Scope, param: TuningParam, event: Event): void {
    this.edit(scope, param, event, 0);
  }

  async applyPreset(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    this.busy.set(true);
    try {
      await this.api.applyPreset(select.value);
    } catch (error) {
      this.notifications.push('alert', `Preset : ${messageOf(error)}`);
      // Rien n'a changé : la liste revient sur ce qui est réellement appliqué.
      select.value = this.state()?.activePresetId ?? '';
    } finally {
      this.busy.set(false);
    }
  }

  async savePreset(event: Event): Promise<void> {
    event.preventDefault();
    const state = this.state();
    const name = this.presetName().trim();
    if (!state || !name) return;
    // Aucun détecteur réglé à la main : le preset laisse chaque Pi sur son fichier.
    const tuned = this.targetCameras().find((camera) => camera.mode === 'live');
    const detector = tuned?.wanted ? { ...tuned.wanted } : null;
    await this.run(
      () => this.api.savePreset(name, detector, { ...state.fusion.values }),
      'Preset',
      `Preset « ${name} » enregistré`,
    );
    this.presetName.set('');
  }

  /** Deux clics : le premier demande confirmation, le second supprime. */
  async deletePreset(id: string): Promise<void> {
    if (this.confirmingDelete() !== id) {
      this.confirmingDelete.set(id);
      if (this.deleteTimer) clearTimeout(this.deleteTimer);
      this.deleteTimer = setTimeout(() => this.confirmingDelete.set(null), DELETE_CONFIRM_MS);
      return;
    }
    this.confirmingDelete.set(null);
    await this.run(() => this.api.deletePreset(id), 'Preset', 'Preset supprimé');
  }

  async resetDetector(): Promise<void> {
    const target = this.target();
    await this.run(
      () => this.api.resetDetector(target === ALL_CAMERAS ? undefined : target),
      'Détection',
    );
  }

  async resetFusion(): Promise<void> {
    await this.run(() => this.api.resetFusion(), 'Fusion');
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    for (const timer of this.timers.values()) clearTimeout(timer);
    if (this.deleteTimer) clearTimeout(this.deleteTimer);
  }

  private async run(action: () => Promise<unknown>, what: string, done?: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      if (done) this.notifications.push('info', done);
    } catch (error) {
      this.notifications.push('alert', `${what} : ${messageOf(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private edit(scope: Scope, param: TuningParam, event: Event, delayMs: number): void {
    const input = event.target as HTMLInputElement;
    const typed = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(typed)) return;
    const clamped = Math.min(param.max, Math.max(param.min, typed));
    const value = param.integer
      ? Math.round(clamped)
      : Number(clamped.toFixed(decimalsOf(param.step)));

    const id = `${scope}:${param.key}`;
    this.drafts.update((drafts) => ({ ...drafts, [id]: value }));
    const edit = (this.edits.get(id) ?? 0) + 1;
    this.edits.set(id, edit);
    const target = this.target();
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.push(scope, param, value, target, id, edit);
      }, delayMs),
    );
  }

  private async push(
    scope: Scope,
    param: TuningParam,
    value: number,
    target: string,
    id: string,
    edit: number,
  ): Promise<void> {
    const values: TuningValues = { [param.key]: value };
    try {
      if (scope === 'fusion') await this.api.setFusion(values);
      else await this.api.setDetector(values, target === ALL_CAMERAS ? undefined : [target]);
    } catch (error) {
      this.notifications.push('alert', `${param.label} : ${messageOf(error)}`);
    } finally {
      // Si le curseur a encore bougé depuis, il garde la main sur l'affichage.
      if (this.edits.get(id) === edit) {
        this.drafts.update((drafts) =>
          Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id)),
        );
      }
    }
  }
}

/** Ce qu'un détecteur va appliquer : la demande du VPS, sinon ce qu'il annonce. */
function effectiveValue(state: TuningState, camera: TuningCameraState, key: string): number {
  return camera.wanted?.[key] ?? camera.reported?.[key] ?? state.detectorDefaults[key];
}

/** « 1280 × 720 » pour une valeur de la liste, sinon le nombre et son unité. */
function formatValue(param: TuningParam, value: number): string {
  const choice = param.choices?.find((item) => item.value === value);
  if (choice) return choice.label;
  return param.unit ? `${value} ${param.unit}` : String(value);
}
