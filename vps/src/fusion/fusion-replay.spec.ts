import { parseRecording, replay } from './fusion-replay';
import {
  BASE_SCENARIO,
  generateObservations,
  straightLine,
} from './fusion-sim';

describe('fusion replay', () => {
  it('replays a recording and scores it against a static truth', () => {
    const mark = { x: 1, y: 30, z: 12 };
    const arrivals = generateObservations(
      {
        ...BASE_SCENARIO,
        durationS: 2,
        headingBiasDeg: 0,
        targets: [straightLine(mark, { x: 0, y: 0, z: 0 })],
      },
      Date.now() * 1000,
    );
    const jsonl =
      arrivals.map((a) => JSON.stringify(a.obs)).join('\n') + '\n{"trunc';
    const observations = parseRecording(jsonl);
    expect(observations).toHaveLength(arrivals.length);

    const summary = replay(observations, mark);
    expect(summary.cameras).toEqual(['jean', 'tanel', 'walid']);
    expect(summary.fusesOk).toBeGreaterThan(20);
    expect(summary.trackIds).toHaveLength(1);
    expect(summary.trackRmseM).not.toBeNull();
    expect(summary.trackRmseM!).toBeLessThan(0.5);
    expect(summary.meanResidualPx!).toBeLessThan(5);
  });
});
