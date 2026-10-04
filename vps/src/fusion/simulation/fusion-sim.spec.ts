import { FusionService } from '../fusion.service';
import {
  BASE_SCENARIO,
  orbit,
  runScenario,
  straightLine,
  type SimScenario,
} from './fusion-sim';

// Banc de non-régression de bout en bout : des scènes fabriquées passent
// dans FusionService. Les seuils gardent une marge sur les valeurs
// mesurées (voir les notes de la PR).

const CROSSING: SimScenario['targets'] = [
  straightLine({ x: -15, y: 25, z: 10 }, { x: 4, y: 0, z: 0 }),
  straightLine({ x: 15, y: 38, z: 15 }, { x: -3, y: 0.5, z: 0 }),
];

function withEnv(env: Record<string, string>): () => FusionService {
  return () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const service = new FusionService();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return service;
  };
}

describe('fusion simulation bench', () => {
  it('tracks one straight pass with a single id', () => {
    const m = runScenario({
      ...BASE_SCENARIO,
      targets: [straightLine({ x: -15, y: 30, z: 12 }, { x: 4, y: 0, z: 0.3 })],
    });
    expect(m.rmseM).toBeLessThan(0.8);
    expect(m.distinctIds).toBe(1);
    expect(m.idSwitches).toBe(0);
    expect(m.coverage).toBeGreaterThan(0.9);
  });

  it('follows a fast orbit (12 m/s on a 6 m radius)', () => {
    const m = runScenario({
      ...BASE_SCENARIO,
      targets: [orbit({ x: 0, y: 30, z: 12 }, 6, 12)],
    });
    expect(m.rmseM).toBeLessThan(1.0);
    expect(m.distinctIds).toBe(1);
  });

  it('keeps two simultaneous targets apart', () => {
    const m = runScenario({ ...BASE_SCENARIO, targets: CROSSING });
    expect(m.distinctIds).toBe(2);
    expect(m.idSwitches).toBe(0);
    expect(m.rmseM).toBeLessThan(0.5);
    expect(m.falseRatio).toBeLessThan(0.02);
  });

  it('keeps the track while one camera loses the target', () => {
    const m = runScenario({
      ...BASE_SCENARIO,
      visible: (cam, _t, tS) => !(cam === 'walid' && tS > 3 && tS < 5),
      targets: [straightLine({ x: -15, y: 30, z: 12 }, { x: 4, y: 0, z: 0.3 })],
    });
    expect(m.distinctIds).toBe(1);
    expect(m.coverage).toBeGreaterThan(0.9);
  });

  it('rejects false blobs once the residual gate matches calibration', () => {
    const m = runScenario(
      {
        ...BASE_SCENARIO,
        falseBlobsPerFrame: 1,
        targets: [
          straightLine({ x: -15, y: 25, z: 10 }, { x: 4, y: 0, z: 0 }),
          orbit({ x: 3, y: 35, z: 14 }, 5, 8),
        ],
      },
      withEnv({ FUSION_MAX_RESIDUAL_PX: '25' }),
    );
    expect(m.idSwitches).toBe(0);
    expect(m.falseRatio).toBeLessThan(0.05);
    expect(m.coverage).toBeGreaterThan(0.9);
  });
});
