import { FusionObservation } from '../fusion.types';
import { alignCandidates, timeAlignFrameGroups } from './fusion-align';

function observation(
  cameraId: string,
  extra: Partial<FusionObservation> = {},
): FusionObservation {
  return {
    cameraId,
    frameIndex: 0,
    timestampUs: 0,
    x: 100,
    y: 50,
    size: 12,
    confidence: 0.8,
    receivedAtMs: 0,
    ...extra,
  };
}

describe('alignCandidates', () => {
  const GATE_PX = 60;

  it('lerps two samples at the midpoint', () => {
    const a = observation('A', {
      timestampUs: 0,
      x: 0,
      y: 0,
      confidence: 0.9,
    });
    const b = observation('A', {
      timestampUs: 1000,
      x: 10,
      y: 20,
      confidence: 0.4,
    });
    const out = alignCandidates(new Map([['A', [a, b]]]), 500, 90, GATE_PX);
    expect(out.get('A')).toHaveLength(1);
    expect(out.get('A')![0].x).toBe(5);
    expect(out.get('A')![0].y).toBe(10);
    expect(out.get('A')![0].confidence).toBe(0.4);
  });

  it('includes a sample 50 ms before tRef with penalty', () => {
    const tRefUs = 100000;
    const obs = observation('A', {
      timestampUs: tRefUs - 50000,
      confidence: 0.5,
    });
    const out = alignCandidates(new Map([['A', [obs]]]), tRefUs, 90, GATE_PX);
    expect(out.get('A')).toHaveLength(1);
    expect(out.get('A')![0].confidence).toBe(0.4);
    expect(obs.confidence).toBe(0.5);
  });

  it('omits a sample 200 ms away', () => {
    const obs = observation('A', { timestampUs: 200000 });
    const out = alignCandidates(new Map([['A', [obs]]]), 0, 90, GATE_PX);
    expect(out.size).toBe(0);
  });

  it('aligns two cameras with a sample at tRef', () => {
    const tRefUs = 1000;
    const out = alignCandidates(
      new Map([
        ['jean', [observation('jean', { timestampUs: tRefUs })]],
        ['tanel', [observation('tanel', { timestampUs: tRefUs })]],
      ]),
      tRefUs,
      90,
      GATE_PX,
    );
    expect([...out.keys()].sort()).toEqual(['jean', 'tanel']);
  });

  it('returns an empty map for no history', () => {
    expect(alignCandidates(new Map(), 0, 90, GATE_PX).size).toBe(0);
  });

  it('interpolates each object with itself, never across objects', () => {
    // Two objects far apart; the Pi reorders them between frames.
    const t0 = [
      observation('A', { timestampUs: 0, x: 100, y: 100 }),
      observation('A', { timestampUs: 0, x: 900, y: 500 }),
    ];
    const t1 = [
      observation('A', { timestampUs: 40000, x: 910, y: 500 }),
      observation('A', { timestampUs: 40000, x: 110, y: 100 }),
    ];
    const out = alignCandidates(
      new Map([['A', [...t0, ...t1]]]),
      20000,
      20,
      GATE_PX,
    );
    const xs = out
      .get('A')!
      .map((o) => o.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([105, 905]);
  });

  it('holds an unmatched blob from the nearer frame', () => {
    const a = observation('A', { timestampUs: 0, x: 100, y: 100 });
    const b = observation('A', { timestampUs: 40000, x: 800, y: 600 });
    const out = alignCandidates(new Map([['A', [a, b]]]), 10000, 20, GATE_PX);
    expect(out.get('A')).toHaveLength(1);
    expect(out.get('A')![0].x).toBe(100);
    expect(out.get('A')![0].confidence).toBeCloseTo(0.64);
  });
});

describe('timeAlignFrameGroups', () => {
  it('keeps every blob from the nearest frame of each camera', () => {
    const jeanA = observation('jean', {
      frameIndex: 20,
      timestampUs: 1_000_000,
      x: 100,
    });
    const jeanB = observation('jean', {
      frameIndex: 20,
      timestampUs: 1_000_000,
      x: 500,
    });
    const stale = observation('jean', {
      frameIndex: 19,
      timestampUs: 966_667,
    });
    const tanel = observation('tanel', {
      frameIndex: 21,
      timestampUs: 1_008_000,
    });
    const out = timeAlignFrameGroups(
      new Map([
        ['jean', [stale, jeanA, jeanB]],
        ['tanel', [tanel]],
      ]),
      1_000_000,
      20,
    );
    expect(out).toHaveLength(3);
    expect(
      out.filter((item) => item.cameraId === 'jean').map((item) => item.x),
    ).toEqual([100, 500]);
    expect(
      out.find((item) => item.cameraId === 'tanel')?.confidence,
    ).toBeCloseTo(0.64);
  });
});
