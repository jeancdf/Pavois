import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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
} from './tuning.params';

describe('tuning parameter tables', () => {
  it('gives every detector setting a default inside its bounds', () => {
    expect(Object.keys(DETECTOR_DEFAULTS)).toEqual(
      DETECTOR_PARAMS.map((param) => param.key),
    );
    expect(checkValues(DETECTOR_PARAMS, DETECTOR_DEFAULTS)).toEqual({
      values: DETECTOR_DEFAULTS,
    });
  });

  it('keeps every slider inside the bounds the API accepts', () => {
    for (const param of [...DETECTOR_PARAMS, ...FUSION_PARAMS]) {
      expect(param.sliderMin ?? param.min).toBeGreaterThanOrEqual(param.min);
      expect(param.sliderMax ?? param.max).toBeLessThanOrEqual(param.max);
      expect(param.step).toBeGreaterThan(0);
    }
  });

  it('ships built-in presets the API itself would accept', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(checkValues(FUSION_PARAMS, preset.fusion)).toEqual({
        values: preset.fusion,
      });
      if (preset.detector) {
        expect(checkValues(DETECTOR_PARAMS, preset.detector)).toEqual({
          values: preset.detector,
        });
      }
    }
    expect(new Set(BUILTIN_PRESETS.map((preset) => preset.id)).size).toBe(
      BUILTIN_PRESETS.length,
    );
  });
});

describe('checkValues', () => {
  it('accepts a partial set of known values', () => {
    expect(
      checkValues(DETECTOR_PARAMS, { diff_threshold: 9, adaptive_k: 1.5 }),
    ).toEqual({ values: { diff_threshold: 9, adaptive_k: 1.5 } });
  });

  it('names the setting it refuses', () => {
    const error = (input: unknown) => {
      const checked = checkValues(DETECTOR_PARAMS, input);
      return 'error' in checked ? checked.error : null;
    };
    expect(error({ width: 640 })).toContain('width');
    expect(error({ diff_threshold: 300 })).toContain('Seuil de différence');
    expect(error({ diff_threshold: 0 })).toContain('hors des bornes');
    expect(error({ diff_threshold: 9.5 })).toContain('entier');
    expect(error({ adaptive_k: '2' })).toContain('nombre');
    expect(error({ adaptive_k: NaN })).toContain('nombre');
    expect(error([1, 2])).toContain('objet');
    expect(error(null)).toContain('objet');
    expect(error({ capture_width: 700 })).toContain('liste');
  });

  it('takes an image size from its list, 0 leaving the Pi on its file', () => {
    expect(checkValues(DETECTOR_PARAMS, { capture_width: 640 })).toEqual({
      values: { capture_width: 640 },
    });
    expect(
      checkValues(DETECTOR_PARAMS, {
        capture_width: 0,
        shutter_us: 0,
        analogue_gain: 0,
      }),
    ).toEqual({ values: { capture_width: 0, shutter_us: 0, analogue_gain: 0 } });
  });

  it('takes the exposure mode from its list and a compensation within 8 stops', () => {
    const error = (input: unknown) => {
      const checked = checkValues(DETECTOR_PARAMS, input);
      return 'error' in checked ? checked.error : null;
    };
    for (const mode of [0, 1, 2]) {
      expect(checkValues(DETECTOR_PARAMS, { auto_exposure: mode })).toEqual({
        values: { auto_exposure: mode },
      });
    }
    expect(error({ auto_exposure: 3 })).toContain('Exposition');
    expect(checkValues(DETECTOR_PARAMS, { ev: -1.5 })).toEqual({
      values: { ev: -1.5 },
    });
    expect(error({ ev: 9 })).toContain('hors des bornes');
  });

  it('shows the exposure mode as a switch, and only choice lists ask for one', () => {
    const all = [...DETECTOR_PARAMS, ...FUSION_PARAMS];
    const switches = all.filter((param) => param.switch);
    expect(switches.map((param) => param.key)).toEqual(['auto_exposure']);
    for (const param of switches) {
      expect(param.choices?.length).toBeGreaterThan(1);
    }
  });
});

describe('keepKnownValues', () => {
  it('drops what another version of the file may contain', () => {
    expect(
      keepKnownValues(DETECTOR_PARAMS, {
        diff_threshold: 9,
        removed_setting: 3,
        adaptive_k: 99,
        morph_open: 'x',
      }),
    ).toEqual({ diff_threshold: 9 });
    expect(keepKnownValues(DETECTOR_PARAMS, null)).toEqual({});
  });
});

describe('detector command body', () => {
  it('fills missing settings with their default', () => {
    const values = completeDetectorValues({ diff_threshold: 9 });
    expect(values).toEqual({ ...DETECTOR_DEFAULTS, diff_threshold: 9 });
  });

  it('raises confirm_n to confirm_m, as the detector does', () => {
    const values = completeDetectorValues({ confirm_m: 5, confirm_n: 2 });
    expect(values.confirm_n).toBe(5);
  });

  it('lists every setting in table order', () => {
    expect(detectorSettingsLine(DETECTOR_DEFAULTS)).toBe(
      'diff_threshold=14,adaptive_k=2.2,blur_radius=1,morph_open=1,' +
        'morph_close=2,min_blob_area=12,max_blob_area_ratio=0.12,' +
        'min_blob_fill_ratio=0.1,max_blob_aspect=6,border_ignore_px=6,' +
        'confirm_m=2,confirm_n=3,bg_learn_rate=0.05,bg_learn_rate_fg=0.002,' +
        'bg_hold_frames=90,illumination_hot_ratio=0.45,' +
        'capture_width=0,shutter_us=0,analogue_gain=0,auto_exposure=0,ev=0',
    );
  });

  it('writes a float without rounding noise', () => {
    const values = { ...DETECTOR_DEFAULTS, adaptive_k: 0.1 + 0.2 };
    expect(detectorSettingsLine(values)).toContain('adaptive_k=0.3,');
  });

  it('versions a settings line by its content, never as 0', () => {
    const line = detectorSettingsLine(DETECTOR_DEFAULTS);
    const other = detectorSettingsLine({
      ...DETECTOR_DEFAULTS,
      diff_threshold: 15,
    });
    expect(settingsVersion(line)).toBe(settingsVersion(line));
    expect(settingsVersion(line)).not.toBe(settingsVersion(other));
    for (const text of [line, other, '', 'a']) {
      const version = settingsVersion(text);
      expect(Number.isInteger(version)).toBe(true);
      expect(version).toBeGreaterThan(0);
      expect(version).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

// The detector clamps with its own copy of this table. The two must agree,
// or the panel would offer a value the Pi silently changes.
const detectorSource = join(
  __dirname,
  '../../pavois++/src/config/live_tuning.cpp',
);
const describeWithDetector = existsSync(detectorSource)
  ? describe
  : describe.skip;

describeWithDetector('detector table in pavois++', () => {
  it('has the same keys, bounds and types as the VPS table', () => {
    const source = readFileSync(detectorSource, 'utf8');
    const rows = [
      ...source.matchAll(
        /\{"([a-z_]+)",\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(true|false),/g,
      ),
    ].map(([, key, min, max, integer]) => ({
      key,
      min: Number(min),
      max: Number(max),
      integer: integer === 'true',
    }));
    expect(rows).toEqual(
      DETECTOR_PARAMS.map(({ key, min, max, integer }) => ({
        key,
        min,
        max,
        integer,
      })),
    );
  });
});
