import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CamerasService } from './cameras/cameras.service';
import { FusionService } from './fusion.service';
import {
  DETECTOR_DEFAULTS,
  detectorSettingsLine,
  settingsVersion,
} from './tuning.params';
import { TuningService } from './tuning.service';
import type { DetectorReport } from './udp/udp-config';

const ENV_KEYS = [
  'TUNING_FILE',
  'CAMERAS_FILE',
  'UDP_HMAC_SECRET',
  'UDP_SECRET_KEY',
  'FUSE_BROADCAST_MS',
] as const;

function report(
  cameraId: string,
  version: number,
  values: Record<string, number> = DETECTOR_DEFAULTS,
): DetectorReport {
  return {
    type: 'detector_config',
    cameraId,
    timestamp: 1,
    version,
    values: { width: 640, height: 360, ...values },
  };
}

function versionOf(values: Record<string, number>): number {
  return settingsVersion(detectorSettingsLine(values));
}

describe('TuningService', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let filePath: string;
  let fusion: FusionService;
  let service: TuningService;

  function build(): TuningService {
    fusion = new FusionService();
    return new TuningService(fusion, new CamerasService());
  }

  function camera(cameraId: string) {
    return service.state().cameras.find((item) => item.cameraId === cameraId)!;
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    filePath = join(
      mkdtempSync(join(tmpdir(), 'pavois-tuning-')),
      'tuning.json',
    );
    process.env.TUNING_FILE = filePath;
    process.env.CAMERAS_FILE = join(tmpdir(), 'pavois-no-cameras.json');
    process.env.UDP_HMAC_SECRET = 'test-secret';
    delete process.env.UDP_SECRET_KEY;
    delete process.env.FUSE_BROADCAST_MS;
    service = build();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('at start-up', () => {
    it('leaves every detector alone and matches the default preset', () => {
      const state = service.state();
      expect(state.cameras.map((item) => item.cameraId)).toEqual([
        'jean',
        'tanel',
        'walid',
      ]);
      expect(state.cameras.every((item) => item.mode === 'untouched')).toBe(
        true,
      );
      expect(state.cameras.every((item) => item.synced)).toBe(true);
      expect(state.fusion.values).toEqual(state.fusion.defaults);
      expect(state.fusion.values).toMatchObject({
        intervalMs: 33,
        maxResidualPx: 120,
        broadcastMs: 50,
      });
      expect(state.activePresetId).toBe('defaut');
      expect(state.detectorCommands).toBe(true);
      expect(service.pendingCameraIds()).toEqual([]);
    });
  });

  describe('fusion settings', () => {
    it('reach the running engine and survive a restart', () => {
      service.setFusion({ maxResidualPx: 40, intervalMs: 22 });
      expect(fusion.tuning()).toMatchObject({
        maxResidualPx: 40,
        intervalMs: 22,
      });
      expect(service.state().fusion.values.maxResidualPx).toBe(40);

      service = build();
      expect(fusion.tuning()).toMatchObject({
        maxResidualPx: 40,
        intervalMs: 22,
      });
      // The start-up value stays the reference a reset goes back to.
      expect(service.state().fusion.defaults.maxResidualPx).toBe(120);
    });

    it('go back to the start-up values on reset', () => {
      service.setFusion({ maxResidualPx: 40 });
      service.resetFusion();
      expect(fusion.tuning().maxResidualPx).toBe(120);
      expect(service.state().fusion.values).toEqual(
        service.state().fusion.defaults,
      );
    });

    it('carry the display period, which the engine does not own', () => {
      expect(service.broadcastMs()).toBe(50);
      service.setFusion({ broadcastMs: 20 });
      expect(service.broadcastMs()).toBe(20);
    });

    it('refuse a bad value and change nothing', () => {
      expect(() => service.setFusion({ maxResidualPx: 0 })).toThrow(
        /hors des bornes/,
      );
      expect(() => service.setFusion({ intervalMs: 22.5 })).toThrow(/entier/);
      expect(() => service.setFusion({ nope: 1 })).toThrow(/inconnu/);
      expect(() =>
        service.setFusion({ maxResidualPx: 40, intervalMs: 0 }),
      ).toThrow();
      expect(fusion.tuning().maxResidualPx).toBe(120);
    });
  });

  describe('detector settings', () => {
    it('are resent until the detector reports the wanted version', () => {
      service.setDetector(undefined, { diff_threshold: 8 });
      const wanted = { ...DETECTOR_DEFAULTS, diff_threshold: 8 };
      const version = versionOf(wanted);
      expect(camera('jean')).toMatchObject({
        mode: 'live',
        wanted,
        synced: false,
      });
      expect(service.pendingCommand('jean')).toBe(
        `set,jean,${version},${detectorSettingsLine(wanted)}`,
      );
      expect(service.pendingCameraIds()).toEqual(['jean', 'tanel', 'walid']);

      // Still on its config file: the command goes out again.
      service.noteReport(report('jean', 0));
      expect(service.pendingCommand('jean')).not.toBeNull();

      service.noteReport(report('jean', version, wanted));
      expect(service.pendingCommand('jean')).toBeNull();
      expect(camera('jean').synced).toBe(true);
      expect(service.pendingCameraIds()).toEqual(['tanel', 'walid']);
    });

    it('come back after the detector restarts on its config file', () => {
      service.setDetector(['jean'], { diff_threshold: 8 });
      const version = versionOf({ ...DETECTOR_DEFAULTS, diff_threshold: 8 });
      service.noteReport(report('jean', version));
      expect(service.pendingCommand('jean')).toBeNull();

      service.noteReport(report('jean', 0));
      expect(service.pendingCommand('jean')).toContain(`set,jean,${version},`);
      expect(camera('jean').synced).toBe(false);
    });

    it('start from what the detector really runs, not from the defaults', () => {
      service.noteReport(
        report('jean', 0, { ...DETECTOR_DEFAULTS, min_blob_area: 20 }),
      );
      service.setDetector(['jean'], { diff_threshold: 9 });
      expect(camera('jean').wanted).toMatchObject({
        diff_threshold: 9,
        min_blob_area: 20,
      });
    });

    it('accumulate over successive changes', () => {
      service.setDetector(['jean'], { diff_threshold: 9 });
      service.setDetector(['jean'], { min_blob_area: 30 });
      expect(camera('jean').wanted).toMatchObject({
        diff_threshold: 9,
        min_blob_area: 30,
      });
    });

    it('only touch the cameras that were named', () => {
      service.setDetector(['tanel'], { diff_threshold: 9 });
      expect(camera('tanel').mode).toBe('live');
      expect(camera('jean').mode).toBe('untouched');
      expect(service.pendingCommand('jean')).toBeNull();
      expect(() =>
        service.setDetector(['ghost'], { diff_threshold: 9 }),
      ).toThrow(/Caméra inconnue/);
    });

    it('keep confirm_n at or above confirm_m', () => {
      service.setDetector(['jean'], { confirm_m: 5 });
      expect(camera('jean').wanted).toMatchObject({
        confirm_m: 5,
        confirm_n: 5,
      });
    });

    it('refuse a setting that needs the capture restarted', () => {
      expect(() => service.setDetector(undefined, { width: 640 })).toThrow(
        /inconnu/,
      );
      expect(camera('jean').mode).toBe('untouched');
    });

    it('hand a detector back to its config file with version 0', () => {
      service.setDetector(['jean'], { diff_threshold: 8 });
      service.noteReport(
        report('jean', versionOf({ ...DETECTOR_DEFAULTS, diff_threshold: 8 })),
      );
      service.resetDetector(['jean']);
      expect(camera('jean')).toMatchObject({
        mode: 'file',
        wanted: null,
        synced: false,
      });
      expect(service.pendingCommand('jean')).toBe('set,jean,0');

      service.noteReport(report('jean', 0));
      expect(service.pendingCommand('jean')).toBeNull();
      expect(camera('jean').synced).toBe(true);
    });

    it('survive a VPS restart', () => {
      service.setDetector(['jean'], { diff_threshold: 8 });
      service.resetDetector(['tanel']);
      service = build();
      expect(camera('jean')).toMatchObject({ mode: 'live', synced: false });
      expect(camera('jean').wanted?.diff_threshold).toBe(8);
      expect(camera('tanel').mode).toBe('file');
      expect(camera('walid').mode).toBe('untouched');
    });
  });

  describe('what a detector reports', () => {
    it('is shown as is, frame size included', () => {
      service.noteReport(
        report('jean', 0, { ...DETECTOR_DEFAULTS, diff_threshold: 11 }),
      );
      expect(camera('jean')).toMatchObject({
        reportedVersion: 0,
        width: 640,
        height: 360,
        synced: true,
      });
      expect(camera('jean').reported?.diff_threshold).toBe(11);
      expect(camera('jean').reported).not.toHaveProperty('width');
    });

    it('is flagged as changed only when it differs from the last one', () => {
      expect(service.noteReport(report('jean', 0))).toBe(true);
      expect(service.noteReport(report('jean', 0))).toBe(false);
      expect(service.noteReport(report('jean', 7))).toBe(true);
      expect(
        service.noteReport(
          report('jean', 7, { ...DETECTOR_DEFAULTS, diff_threshold: 9 }),
        ),
      ).toBe(true);
    });

    it('adds a camera the VPS did not know', () => {
      service.noteReport(report('pi-extra', 0));
      expect(service.state().cameras.map((item) => item.cameraId)).toEqual([
        'jean',
        'tanel',
        'walid',
        'pi-extra',
      ]);
    });
  });

  describe('presets', () => {
    it('set detectors and fusion in one go', () => {
      service.applyPreset('sensible');
      const state = service.state();
      expect(state.activePresetId).toBe('sensible');
      expect(state.fusion.values.maxBlobsPerCamera).toBe(16);
      expect(fusion.tuning().maxBlobsPerCamera).toBe(16);
      for (const item of state.cameras) {
        expect(item.wanted).toMatchObject({
          diff_threshold: 8,
          min_blob_area: 4,
          morph_open: 0,
        });
      }
    });

    it('replace the previous preset entirely', () => {
      service.applyPreset('sensible');
      service.applyPreset('strict');
      const state = service.state();
      expect(state.activePresetId).toBe('strict');
      // "sensible" raised this one; "strict" does not mention it.
      expect(state.fusion.values.maxBlobsPerCamera).toBe(8);
      expect(state.fusion.values.maxResidualPx).toBe(25);
      expect(state.cameras[0].wanted).toMatchObject({
        diff_threshold: 20,
        morph_open: 1,
      });
    });

    it('stop matching as soon as one value is changed by hand', () => {
      service.applyPreset('strict');
      service.setFusion({ maxResidualPx: 30 });
      expect(service.state().activePresetId).toBeNull();
      service.setFusion({ maxResidualPx: 25 });
      expect(service.state().activePresetId).toBe('strict');
      service.setDetector(['jean'], { diff_threshold: 21 });
      expect(service.state().activePresetId).toBeNull();
    });

    it('return tuned detectors to their config file with the default preset', () => {
      service.applyPreset('sensible');
      service.applyPreset('defaut');
      const state = service.state();
      expect(state.activePresetId).toBe('defaut');
      expect(state.cameras.every((item) => item.mode === 'file')).toBe(true);
      expect(service.pendingCommand('jean')).toBe('set,jean,0');
      expect(state.fusion.values).toEqual(state.fusion.defaults);
    });

    it('do not send anything to detectors nobody tuned', () => {
      service.applyPreset('multi-cibles');
      expect(service.state().activePresetId).toBe('multi-cibles');
      expect(service.pendingCameraIds()).toEqual([]);
    });

    it('can be saved, replaced by name, restored and deleted', () => {
      const detector = { ...DETECTOR_DEFAULTS, diff_threshold: 11 };
      const saved = service.savePreset({
        name: '  Hangar  ',
        detector,
        fusion: { maxResidualPx: 33 },
      });
      expect(saved).toMatchObject({ name: 'Hangar', builtin: false });

      const replaced = service.savePreset({
        name: 'hangar',
        detector: null,
        fusion: { maxResidualPx: 44 },
      });
      expect(replaced.id).toBe(saved.id);
      const custom = () =>
        service.state().presets.filter((preset) => !preset.builtin);
      expect(custom()).toHaveLength(1);

      service = build();
      expect(custom()[0]).toMatchObject({
        id: saved.id,
        name: 'hangar',
        detector: null,
        fusion: { maxResidualPx: 44 },
      });
      service.applyPreset(saved.id);
      expect(service.state().activePresetId).toBe(saved.id);
      expect(fusion.tuning().maxResidualPx).toBe(44);

      service.deletePreset(saved.id);
      expect(custom()).toHaveLength(0);
      expect(() => service.deletePreset(saved.id)).toThrow(/inconnu/);
    });

    it('refuse a bad name, a built-in name and bad values', () => {
      expect(() => service.savePreset({ name: ' ', fusion: {} })).toThrow(
        /Nom de preset/,
      );
      expect(() =>
        service.savePreset({ name: 'x'.repeat(41), fusion: {} }),
      ).toThrow(/Nom de preset/);
      expect(() => service.savePreset({ name: 'strict', fusion: {} })).toThrow(
        /intégré/,
      );
      expect(() =>
        service.savePreset({ name: 'A', fusion: { maxResidualPx: -1 } }),
      ).toThrow(/hors des bornes/);
      expect(() =>
        service.savePreset({ name: 'A', detector: { width: 1 }, fusion: {} }),
      ).toThrow(/inconnu/);
      expect(() => service.deletePreset('strict')).toThrow(/intégré/);
      expect(() => service.applyPreset('nope')).toThrow(/inconnu/);
    });
  });

  describe('without UDP_HMAC_SECRET', () => {
    beforeEach(() => {
      delete process.env.UDP_HMAC_SECRET;
      service = build();
    });

    it('refuses to tune detectors, which would ignore the command', () => {
      expect(service.state().detectorCommands).toBe(false);
      expect(() =>
        service.setDetector(undefined, { diff_threshold: 8 }),
      ).toThrow(/UDP_HMAC_SECRET/);
      expect(() => service.resetDetector(undefined)).toThrow(/UDP_HMAC_SECRET/);
      expect(service.pendingCameraIds()).toEqual([]);
    });

    it('still tunes the fusion engine, presets included', () => {
      service.applyPreset('sensible');
      expect(fusion.tuning().maxBlobsPerCamera).toBe(16);
      expect(service.state().cameras.every((c) => c.mode === 'untouched')).toBe(
        true,
      );
    });
  });

  describe('the settings file', () => {
    it('is written as the operator changes things', () => {
      service.setFusion({ maxResidualPx: 40 });
      service.setDetector(['jean'], { diff_threshold: 8 });
      const stored = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(stored.fusion).toEqual({ maxResidualPx: 40 });
      expect(stored.detectors.jean.mode).toBe('live');
      expect(stored.detectors.jean.values.diff_threshold).toBe(8);
    });

    it('blocks start-up when unreadable rather than be overwritten', () => {
      writeFileSync(filePath, '{ not json');
      expect(() => build()).toThrow(/Réglages illisibles/);
    });

    it('drops values another version left behind', () => {
      writeFileSync(
        filePath,
        JSON.stringify({
          fusion: { maxResidualPx: 40, removedSetting: 3, intervalMs: 9999 },
          detectors: {
            jean: { mode: 'live', values: { diff_threshold: 8, gone: 1 } },
            tanel: { mode: 'weird' },
          },
          presets: [{ id: 'perso-1', name: 'Old', fusion: { gone: 2 } }, 42],
        }),
      );
      service = build();
      expect(fusion.tuning()).toMatchObject({
        maxResidualPx: 40,
        intervalMs: 33,
      });
      expect(camera('jean').wanted).toEqual({
        ...DETECTOR_DEFAULTS,
        diff_threshold: 8,
      });
      expect(camera('tanel').mode).toBe('untouched');
      expect(
        service.state().presets.find((preset) => preset.id === 'perso-1'),
      ).toMatchObject({ name: 'Old', detector: null, fusion: {} });
    });
  });
});
