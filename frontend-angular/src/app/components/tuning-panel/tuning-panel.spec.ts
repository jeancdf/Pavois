import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TuningPanel } from './tuning-panel';
import { NotificationService } from '../../services/notification.service';
import { RealtimeService } from '../../services/realtime.service';
import { TuningService } from '../../services/tuning.service';
import type {
  TuningCameraState,
  TuningParam,
  TuningState,
  TuningValues,
} from '../../models/tuning.model';

const DETECTOR_PARAMS: TuningParam[] = [
  {
    key: 'diff_threshold',
    group: 'Seuil',
    label: 'Seuil de différence',
    hint: 'Écart minimal avec le fond.',
    unit: 'niveaux',
    min: 1,
    max: 255,
    sliderMax: 60,
    step: 1,
    integer: true,
  },
  {
    key: 'adaptive_k',
    group: 'Seuil',
    label: 'Marge sur le bruit',
    hint: 'Multiplicateur du bruit.',
    min: 0,
    max: 10,
    step: 0.1,
    integer: false,
  },
  {
    key: 'min_blob_area',
    group: 'Forme des blobs',
    label: 'Surface minimale',
    hint: 'Blob plus petit ignoré.',
    unit: 'px²',
    min: 1,
    max: 5000,
    sliderMax: 200,
    step: 1,
    integer: true,
  },
];

const FUSION_PARAMS: TuningParam[] = [
  {
    key: 'maxResidualPx',
    group: 'Triangulation',
    label: 'Résidu maximal',
    hint: 'Écart toléré.',
    unit: 'px',
    min: 1,
    max: 500,
    sliderMax: 200,
    step: 1,
    integer: false,
  },
  {
    key: 'intervalMs',
    group: 'Cadence',
    label: 'Période de fusion',
    hint: '33 ms = 30 fusions par seconde.',
    unit: 'ms',
    min: 5,
    max: 200,
    step: 1,
    integer: true,
  },
];

const DEFAULTS: TuningValues = { diff_threshold: 14, adaptive_k: 2.2, min_blob_area: 12 };

function camera(cameraId: string, extra: Partial<TuningCameraState> = {}): TuningCameraState {
  return {
    cameraId,
    mode: 'untouched',
    wanted: null,
    reported: { ...DEFAULTS },
    reportedVersion: 0,
    width: 640,
    height: 360,
    synced: true,
    ...extra,
  };
}

function makeState(extra: Partial<TuningState> = {}): TuningState {
  return {
    type: 'tuning_state',
    params: { detector: DETECTOR_PARAMS, fusion: FUSION_PARAMS },
    detectorDefaults: { ...DEFAULTS },
    fusion: {
      values: { maxResidualPx: 120, intervalMs: 33 },
      defaults: { maxResidualPx: 120, intervalMs: 33 },
    },
    cameras: [camera('jean'), camera('tanel'), camera('walid')],
    presets: [
      {
        id: 'defaut',
        name: 'Défaut',
        description: 'Chaque Pi reprend son fichier.',
        builtin: true,
        detector: null,
        fusion: {},
      },
      {
        id: 'strict',
        name: 'Strict',
        description: 'Seuils hauts.',
        builtin: true,
        detector: { ...DEFAULTS, diff_threshold: 20 },
        fusion: { maxResidualPx: 25 },
      },
    ],
    activePresetId: 'defaut',
    detectorCommands: true,
    ...extra,
  };
}

describe('TuningPanel', () => {
  const tuning = signal<TuningState | null>(null);
  // Camera id -> when its last statistics line arrived (a running detector
  // sends one per second).
  let statsAt: Record<string, number>;
  let exposureOf: Record<string, { exposureUs: number; gainDb: number }>;
  let loaded: TuningState;
  let fixture: ComponentFixture<TuningPanel>;
  let root: HTMLElement;
  let notifications: NotificationService;
  const api = {
    refresh: vi.fn(),
    setDetector: vi.fn(),
    setFusion: vi.fn(),
    resetDetector: vi.fn(),
    resetFusion: vi.fn(),
    applyPreset: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
  };

  function open(state: TuningState = makeState()): void {
    loaded = state;
    fixture = TestBed.createComponent(TuningPanel);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  function input(selector: string): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(selector)!;
  }

  // The number field sits next to the label; the slider carries the id.
  function numberField(id: string): HTMLInputElement {
    return input(`#${id}`).closest('.control')!.querySelector('input[type="number"]')!;
  }

  function move(element: HTMLInputElement, value: string, event: 'input' | 'change'): void {
    element.value = value;
    element.dispatchEvent(new Event(event));
    fixture.detectChanges();
  }

  function button(label: string): HTMLButtonElement {
    return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    )!;
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    tuning.set(null);
    statsAt = { jean: Date.now(), tanel: Date.now(), walid: Date.now() };
    exposureOf = {};
    api.refresh.mockImplementation(() => {
      tuning.set(loaded);
      return Promise.resolve(loaded);
    });
    for (const call of [
      api.setDetector,
      api.setFusion,
      api.resetDetector,
      api.resetFusion,
      api.applyPreset,
      api.savePreset,
      api.deletePreset,
    ]) {
      call.mockImplementation(() => Promise.resolve(tuning()));
    }
    await TestBed.configureTestingModule({
      imports: [TuningPanel],
      providers: [
        { provide: TuningService, useValue: api },
        {
          provide: RealtimeService,
          useValue: {
            tuning,
            statsOf: (id: string) =>
              id in statsAt ? { receivedAt: statsAt[id], ...exposureOf[id] } : undefined,
          },
        },
        NotificationService,
      ],
    }).compileComponents();
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('loads the settings and draws one control per parameter', () => {
    open();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('input[type="range"]')).toHaveLength(5);
    expect(input('#detector-diff_threshold').value).toBe('14');
    expect(numberField('detector-adaptive_k').value).toBe('2.2');
    expect(input('#fusion-maxResidualPx').value).toBe('120');
    const legends = [...root.querySelectorAll('legend')].map((item) => item.textContent?.trim());
    expect(legends).toEqual(['Seuil', 'Forme des blobs', 'Triangulation', 'Cadence']);
    expect(root.textContent).toContain('Seuil de différence');
    expect(root.textContent).toContain('niveaux');
  });

  it('keeps the slider inside its own range while the field accepts the full one', () => {
    open();
    expect(input('#detector-diff_threshold').max).toBe('60');
    expect(numberField('detector-diff_threshold').max).toBe('255');
  });

  it('shows the preset that matches the current state', () => {
    open();
    const select = root.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('defaut');
    expect(root.querySelector('.preset-desc')?.textContent).toContain('Chaque Pi reprend');
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'Défaut',
      'Strict',
    ]);
  });

  it('says so when values were changed by hand', () => {
    open(makeState({ activePresetId: null }));
    const select = root.querySelector<HTMLSelectElement>('select')!;
    expect(select.options[0].textContent?.trim()).toBe('Personnalisé');
    expect(select.value).toBe('');
    expect(root.querySelector('.preset-desc')?.textContent).toContain('à la main');
  });

  it('sends a moved detector slider to every camera once the gesture pauses', () => {
    open();
    move(input('#detector-diff_threshold'), '9', 'input');
    // Shown at once, sent a little later.
    expect(numberField('detector-diff_threshold').value).toBe('9');
    vi.advanceTimersByTime(119);
    expect(api.setDetector).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(api.setDetector).toHaveBeenCalledTimes(1);
    expect(api.setDetector).toHaveBeenCalledWith({ diff_threshold: 9 }, undefined);
  });

  it('groups a dragged slider into one request carrying the last value', () => {
    open();
    const slider = input('#detector-diff_threshold');
    for (const value of ['10', '11', '12']) {
      move(slider, value, 'input');
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(120);
    expect(api.setDetector).toHaveBeenCalledTimes(1);
    expect(api.setDetector).toHaveBeenCalledWith({ diff_threshold: 12 }, undefined);
  });

  it('sends at once when the slider is released', () => {
    open();
    const slider = input('#detector-diff_threshold');
    move(slider, '10', 'input');
    move(slider, '10', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setDetector).toHaveBeenCalledTimes(1);
    expect(api.setDetector).toHaveBeenCalledWith({ diff_threshold: 10 }, undefined);
  });

  const CAPTURE_PARAMS: TuningParam[] = [
    {
      key: 'capture_width',
      group: 'Image',
      label: "Taille d'image",
      hint: 'Pixels de chaque image.',
      unit: 'px',
      min: 0,
      max: 1920,
      step: 1,
      integer: true,
      choices: [
        { value: 0, label: 'Fichier du Pi' },
        { value: 640, label: '640 × 360' },
        { value: 1280, label: '1280 × 720' },
      ],
    },
    {
      key: 'shutter_us',
      group: 'Image',
      label: 'Temps de pose',
      hint: 'Plus long : plus clair.',
      unit: 'µs',
      min: 0,
      max: 1000000,
      sliderMax: 33000,
      step: 100,
      integer: true,
      zeroLabel: 'fichier du Pi',
    },
  ];

  function captureState(extra: Partial<TuningCameraState> = {}): TuningState {
    const reported = { ...DEFAULTS, capture_width: 1280, shutter_us: 16000 };
    return makeState({
      params: { detector: [...DETECTOR_PARAMS, ...CAPTURE_PARAMS], fusion: FUSION_PARAMS },
      detectorDefaults: { ...DEFAULTS, capture_width: 0, shutter_us: 0 },
      cameras: ['jean', 'tanel', 'walid'].map((id) =>
        camera(id, { reported, width: 1280, height: 720, ...extra }),
      ),
    });
  }

  function note(id: string): string | undefined {
    return input(`#detector-${id}`)
      .closest('.control')!
      .querySelector('small.changed')
      ?.textContent?.trim();
  }

  it('offers the image sizes as a list and sends the one chosen', () => {
    open(captureState());
    const select = root.querySelector<HTMLSelectElement>('#detector-capture_width')!;
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'Fichier du Pi',
      '640 × 360',
      '1280 × 720',
    ]);
    expect(select.value).toBe('1280');
    select.value = '640';
    select.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(0);
    expect(api.setDetector).toHaveBeenCalledWith({ capture_width: 640 }, undefined);
  });

  it('shows the exposure mode as a switch and sends the mode clicked at once', () => {
    const exposure: TuningParam = {
      key: 'auto_exposure',
      group: 'Image',
      label: 'Exposition',
      hint: 'Qui règle la pose.',
      min: 0,
      max: 2,
      step: 1,
      integer: true,
      choices: [
        { value: 0, label: 'Fichier du Pi' },
        { value: 1, label: 'Manuelle' },
        { value: 2, label: 'Automatique' },
      ],
      switch: true,
    };
    open(
      makeState({
        params: { detector: [...DETECTOR_PARAMS, exposure], fusion: FUSION_PARAMS },
        detectorDefaults: { ...DEFAULTS, auto_exposure: 0 },
      }),
    );
    const modes = () => [
      ...root.querySelectorAll<HTMLButtonElement>('#detector-auto_exposure button'),
    ];
    expect(modes().map((mode) => mode.textContent?.trim())).toEqual([
      'Fichier du Pi',
      'Manuelle',
      'Automatique',
    ]);
    expect(modes().map((mode) => mode.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);

    modes()[2].click();
    vi.advanceTimersByTime(0);
    fixture.detectChanges();
    expect(api.setDetector).toHaveBeenCalledWith({ auto_exposure: 2 }, undefined);
    expect(modes()[2].classList.contains('on')).toBe(true);
    expect(modes()[0].classList.contains('on')).toBe(false);
  });

  it('says what the Pis really run when a capture setting is left to their file', () => {
    open(captureState({ mode: 'live', wanted: { ...DEFAULTS, capture_width: 0, shutter_us: 0 } }));
    expect(note('shutter_us')).toBe('fichier du Pi : 16000 µs');
    expect(note('capture_width')).toBe('Pi : 1280 × 720');
    // A setting that matches what the Pis run needs no note.
    expect(note('diff_threshold')).toBeUndefined();
  });

  it('says which camera kept its old size when one refused the new one', () => {
    open(
      makeState({
        params: { detector: [...DETECTOR_PARAMS, ...CAPTURE_PARAMS], fusion: FUSION_PARAMS },
        cameras: [
          camera('jean', { mode: 'live', wanted: { capture_width: 640 }, reported: { capture_width: 640 } }),
          camera('tanel', { mode: 'live', wanted: { capture_width: 640 }, reported: { capture_width: 1280 } }),
        ],
      }),
    );
    expect(note('capture_width')).toBe('Pi : jean 640 × 360 · tanel 1280 × 720');
  });

  it('sends only to the camera that is selected', () => {
    open();
    button('tanel').click();
    fixture.detectChanges();
    expect(button('tanel').classList.contains('on')).toBe(true);
    move(input('#detector-min_blob_area'), '30', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setDetector).toHaveBeenCalledWith({ min_blob_area: 30 }, ['tanel']);
  });

  it('shows the selected camera own values', () => {
    open(
      makeState({
        cameras: [
          camera('jean'),
          camera('tanel', { mode: 'live', wanted: { ...DEFAULTS, diff_threshold: 9 } }),
        ],
      }),
    );
    expect(input('#detector-diff_threshold').value).toBe('14');
    button('tanel').click();
    fixture.detectChanges();
    expect(input('#detector-diff_threshold').value).toBe('9');
  });

  it('clamps a typed value to the bounds the backend accepts', () => {
    open();
    move(numberField('detector-diff_threshold'), '999', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setDetector).toHaveBeenCalledWith({ diff_threshold: 255 }, undefined);
  });

  it('rounds to the parameter step and ignores an empty field', () => {
    open();
    move(numberField('detector-adaptive_k'), '1.2345', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setDetector).toHaveBeenCalledWith({ adaptive_k: 1.2 }, undefined);

    api.setDetector.mockClear();
    move(numberField('detector-adaptive_k'), '', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setDetector).not.toHaveBeenCalled();
  });

  it('sends fusion settings to the VPS, not to the cameras', () => {
    open();
    move(input('#fusion-maxResidualPx'), '40', 'change');
    vi.advanceTimersByTime(0);
    expect(api.setFusion).toHaveBeenCalledWith({ maxResidualPx: 40 });
    expect(api.setDetector).not.toHaveBeenCalled();
  });

  it('keeps the dragged value on screen until the backend has answered', async () => {
    open();
    let answer!: (state: TuningState) => void;
    api.setDetector.mockImplementation(
      () => new Promise<TuningState>((resolve) => (answer = resolve)),
    );
    move(input('#detector-diff_threshold'), '9', 'change');
    await settle();
    // The backend still says 14; an update from elsewhere must not pull it back.
    tuning.set(makeState());
    fixture.detectChanges();
    expect(numberField('detector-diff_threshold').value).toBe('9');

    const applied = makeState({
      cameras: [camera('jean', { mode: 'live', wanted: { ...DEFAULTS, diff_threshold: 9 } })],
    });
    tuning.set(applied);
    answer(applied);
    await settle();
    expect(numberField('detector-diff_threshold').value).toBe('9');
    // The draft is gone: the panel follows the backend again.
    tuning.set(makeState());
    fixture.detectChanges();
    expect(numberField('detector-diff_threshold').value).toBe('14');
  });

  it('tells the operator when a value is refused and falls back to the real one', async () => {
    open();
    const pushed = vi.spyOn(notifications, 'push');
    api.setDetector.mockRejectedValue(new Error('hors des bornes'));
    move(input('#detector-diff_threshold'), '9', 'change');
    await settle();
    expect(pushed).toHaveBeenCalledWith('alert', 'Seuil de différence : hors des bornes');
    expect(numberField('detector-diff_threshold').value).toBe('14');
  });

  it('lists each camera value when they differ', () => {
    open(
      makeState({
        cameras: [
          camera('jean'),
          camera('tanel', { mode: 'live', wanted: { ...DEFAULTS, diff_threshold: 9 } }),
          camera('walid'),
        ],
      }),
    );
    const mixed = [...root.querySelectorAll('.mixed')].map((item) => item.textContent?.trim());
    expect(mixed).toEqual(['jean 14 · tanel 9 · walid 14']);
  });

  function cameraRows(): (string | undefined)[] {
    return [...root.querySelectorAll('.cameras li')].map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim(),
    );
  }

  it('shows whether each detector applies what is wanted', () => {
    statsAt['pi-old'] = Date.now();
    const silent = { reported: null, reportedVersion: null, width: null, height: null };
    open(
      makeState({
        cameras: [
          camera('jean', { mode: 'live', wanted: { ...DEFAULTS } }),
          camera('tanel', { mode: 'live', wanted: { ...DEFAULTS }, synced: false }),
          camera('walid'),
          // Sends statistics but never its settings: a build without live tuning.
          camera('pi-old', silent),
          // Sends nothing at all.
          camera('pi-off', { mode: 'live', wanted: { ...DEFAULTS } }),
        ],
      }),
    );
    expect(cameraRows()).toEqual([
      'jean 640×360 réglé',
      'tanel 640×360 en attente',
      'walid 640×360 config du Pi',
      'pi-old — détecteur à mettre à jour',
      'pi-off 640×360 hors ligne',
    ]);
    const tones = [...root.querySelectorAll('.cameras .sync')].map((item) =>
      item.classList.contains('ok') ? 'ok' : item.classList.contains('wait') ? 'wait' : 'off',
    );
    expect(tones).toEqual(['ok', 'wait', 'ok', 'wait', 'off']);
  });

  it('stops calling a detector tuned once it has gone silent', () => {
    open(makeState({ cameras: [camera('jean', { mode: 'live', wanted: { ...DEFAULTS } })] }));
    expect(cameraRows()).toEqual(['jean 640×360 réglé']);
    // The backend still holds its last report, synced; only the clock tells.
    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(cameraRows()).toEqual(['jean 640×360 hors ligne']);

    statsAt['jean'] = Date.now();
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(cameraRows()).toEqual(['jean 640×360 réglé']);
  });

  it('shows the exposure each running camera reports', () => {
    // 10.88 dB is the ×3.5 gain the Pi measured; tanel's Pi does not know its own.
    exposureOf = {
      jean: { exposureUs: 1988, gainDb: 10.88 },
      tanel: { exposureUs: 0, gainDb: 0 },
    };
    open(
      makeState({
        cameras: [
          camera('jean', { mode: 'live', wanted: { ...DEFAULTS } }),
          camera('tanel', { mode: 'live', wanted: { ...DEFAULTS } }),
        ],
      }),
    );
    expect(cameraRows()).toEqual(['jean 640×360 1988 µs ×3.5 réglé', 'tanel 640×360 réglé']);

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(cameraRows()).toEqual(['jean 640×360 hors ligne', 'tanel 640×360 hors ligne']);
  });

  it('applies a preset as soon as it is chosen', async () => {
    open();
    const select = root.querySelector<HTMLSelectElement>('select')!;
    select.value = 'strict';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(api.applyPreset).toHaveBeenCalledWith('strict');
  });

  it('puts the list back when a preset cannot be applied', async () => {
    open();
    const pushed = vi.spyOn(notifications, 'push');
    api.applyPreset.mockRejectedValue(new Error('backend injoignable'));
    const select = root.querySelector<HTMLSelectElement>('select')!;
    select.value = 'strict';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(pushed).toHaveBeenCalledWith('alert', 'Preset : backend injoignable');
    expect(select.value).toBe('defaut');
  });

  it('saves what is on screen as a preset', async () => {
    const wanted = { ...DEFAULTS, diff_threshold: 9 };
    open(makeState({ cameras: [camera('jean', { mode: 'live', wanted })], activePresetId: null }));
    expect(button('Enregistrer').disabled).toBe(true);
    const name = input('input[type="text"]');
    name.value = '  Hangar ';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.savePreset).toHaveBeenCalledWith('Hangar', wanted, {
      maxResidualPx: 120,
      intervalMs: 33,
    });
    expect(input('input[type="text"]').value).toBe('');
  });

  it('saves a preset that leaves the Pis on their own file when none is tuned', async () => {
    open();
    const name = input('input[type="text"]');
    name.value = 'Fusion seule';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.savePreset).toHaveBeenCalledWith('Fusion seule', null, {
      maxResidualPx: 120,
      intervalMs: 33,
    });
  });

  it('asks twice before deleting a saved preset', async () => {
    const state = makeState();
    state.presets.push({
      id: 'perso-1',
      name: 'Hangar',
      description: '',
      builtin: false,
      detector: null,
      fusion: {},
    });
    state.activePresetId = 'perso-1';
    open(state);
    button('Supprimer').click();
    await settle();
    expect(api.deletePreset).not.toHaveBeenCalled();
    button('Confirmer').click();
    await settle();
    expect(api.deletePreset).toHaveBeenCalledWith('perso-1');
  });

  it('offers no delete button for a built-in preset', () => {
    open();
    expect(button('Supprimer')).toBeUndefined();
  });

  it('flags a fusion value that left its start-up value', () => {
    const state = makeState();
    state.fusion.values.maxResidualPx = 40;
    open(state);
    const changed = [...root.querySelectorAll('.changed')].map((item) => item.textContent?.trim());
    expect(changed).toEqual(['démarrage : 120']);
  });

  it('hands detectors back to their file and the engine back to its start-up values', async () => {
    open();
    button('Config des Pi').click();
    await settle();
    expect(api.resetDetector).toHaveBeenCalledWith(undefined);
    button('walid').click();
    fixture.detectChanges();
    button('Config des Pi').click();
    await settle();
    expect(api.resetDetector).toHaveBeenLastCalledWith('walid');
    button('Valeurs de démarrage').click();
    await settle();
    expect(api.resetFusion).toHaveBeenCalledTimes(1);
  });

  it('locks the detector controls when the VPS cannot sign its commands', () => {
    open(makeState({ detectorCommands: false }));
    expect(root.textContent).toContain('UDP_HMAC_SECRET');
    const fieldsets = [...root.querySelectorAll<HTMLFieldSetElement>('fieldset')];
    expect(fieldsets.map((item) => item.disabled)).toEqual([true, true, false, false]);
    expect(button('Config des Pi').disabled).toBe(true);
  });

  it('explains a load failure and tries again on demand', async () => {
    api.refresh.mockRejectedValueOnce(new Error('backend injoignable'));
    open();
    await settle();
    expect(root.textContent).toContain('Réglages indisponibles : backend injoignable');
    expect(root.querySelector('input[type="range"]')).toBeNull();

    button('Réessayer').click();
    await settle();
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('input[type="range"]')).toHaveLength(5);
  });
});
