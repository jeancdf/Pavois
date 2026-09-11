import { FusionObservation } from './fusion.types';
import { timeAlign } from './fusion-align';

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

describe('timeAlign', () => {
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
    const out = timeAlign(new Map([['A', [a, b]]]), 500, 90);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBe(5);
    expect(out[0].y).toBe(10);
    expect(out[0].confidence).toBe(0.4);
  });

  it('includes a sample 50 ms before tRef with penalty', () => {
    const tRefUs = 100000;
    const obs = observation('A', {
      timestampUs: tRefUs - 50000,
      confidence: 0.5,
    });
    const out = timeAlign(new Map([['A', [obs]]]), tRefUs, 90);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.4);
    expect(obs.confidence).toBe(0.5);
  });

  it('omits a sample 200 ms away', () => {
    const obs = observation('A', { timestampUs: 200000 });
    const out = timeAlign(new Map([['A', [obs]]]), 0, 90);
    expect(out).toHaveLength(0);
  });

  it('aligns two cameras with a sample at tRef', () => {
    const tRefUs = 1000;
    const jean = observation('jean', { timestampUs: tRefUs });
    const tanel = observation('tanel', { timestampUs: tRefUs });
    const out = timeAlign(
      new Map([
        ['jean', [jean]],
        ['tanel', [tanel]],
      ]),
      tRefUs,
      90,
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.cameraId).sort()).toEqual(['jean', 'tanel']);
  });

  it('returns [] for an empty map', () => {
    expect(timeAlign(new Map(), 0, 90)).toEqual([]);
  });
});
