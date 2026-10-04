import { vNorm, vSub } from '../geometry/fusion-geo';
import { Tracker, type TrackerConfig } from './fusion-tracker';

describe('Tracker', () => {
  const cfg: Partial<TrackerConfig> = {
    confirmUpdates: 3,
    maxCoastMs: 500,
    maxSpeedMps: 50,
    matchDistanceM: 6,
  };

  it('does not emit before confirm_updates, then one track', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    let emits = 0;
    for (let i = 0; i < 2; i++) {
      t += 50000;
      p.x += 0.4;
      if (tr.update(p, t, 0.8, ['c0', 'c1'])) emits += 1;
    }
    expect(emits).toBe(0);
    for (let i = 0; i < 3; i++) {
      t += 50000;
      p.x += 0.4;
      if (tr.update(p, t, 0.8, ['c0', 'c1'])) emits += 1;
    }
    expect(emits).toBeGreaterThanOrEqual(1);
    const tracks = tr.tick(t);
    expect(tracks).toHaveLength(1);
    // Vitesse du Kalman encore sous 5 m/s : le classement reste « other ».
    expect(tracks[0].classification).toBe('other');
  });

  it('opens two tracks for separated measurements', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += 40000;
      tr.update({ x: 0, y: 20, z: 5 }, t, 0.8, ['c0', 'c1']);
      tr.update({ x: 30, y: 18, z: 5 }, t + 1000, 0.8, ['c0', 'c1']);
    }
    expect(tr.tick(t + 1000)).toHaveLength(2);
  });

  it('keeps the same track id after a recovery gap', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    for (let i = 0; i < 5; i++) {
      t += 40000;
      p.x += 0.3;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    const idBefore = tr.tick(t)[0].objectId;
    t += 250000;
    p.x += 2.0;
    tr.update(p, t, 0.8, ['c0', 'c1']);
    const after = tr.tick(t);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].objectId).toBe(idBefore);
  });

  it('ignores an impossible jump and deletes after coast', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    for (let i = 0; i < 5; i++) {
      t += 40000;
      p.x += 0.3;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    t += 40000;
    tr.update({ x: 900, y: 20, z: 5 }, t, 0.8, ['c0']);
    const a = tr.tick(t);
    expect(a.length).toBeGreaterThan(0);
    const err = vNorm(vSub({ x: a[0].x, y: a[0].y, z: a[0].z }, p));
    expect(err).toBeLessThan(6.0);
    t += 2_000_000;
    expect(tr.tick(t)).toHaveLength(0);
  });

  it('classes a fast high track as airplane once speed settles', () => {
    const tr = new Tracker({
      ...cfg,
      maxSpeedMps: 200,
      matchDistanceM: 12,
    });
    let t = 0;
    const p = { x: 0, y: 0, z: 150 };
    for (let i = 0; i < 40; i++) {
      t += 50_000;
      p.x += 4.5;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    const tracks = tr.tick(t);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].classification).toBe('airplane');
  });

  it('classes a moderate low track as bird once speed settles', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 0, z: 40 };
    for (let i = 0; i < 25; i++) {
      t += 50_000;
      p.x += 0.75;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    const tracks = tr.tick(t);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].classification).toBe('bird');
  });

  it('does not confirm a hyper-fast track', () => {
    const tr = new Tracker({ ...cfg, maxSpeedMps: 3.0 });
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    for (let i = 0; i < 8; i++) {
      t += 40000;
      p.x += 2.0;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    expect(tr.tick(t)).toHaveLength(0);
  });

  it('does not teleport a confirmed track onto a stray point', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    for (let i = 0; i < 6; i++) {
      t += 40000;
      p.x += 0.3;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    const id = tr.tick(t)[0].objectId;
    t += 40000;
    p.x += 0.3;
    // 10 m d'écart : l'ancien seuil de rattrapage réinitialisait la piste.
    tr.update({ x: p.x + 10, y: p.y, z: p.z }, t, 0.8, ['c0', 'c1']);
    const after = tr.tick(t);
    expect(after).toHaveLength(1);
    expect(after[0].objectId).toBe(id);
    expect(Math.abs(after[0].x - p.x)).toBeLessThan(1);
  });

  it('gives a lost track its id back when it reappears nearby', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    for (let i = 0; i < 5; i++) {
      t += 40000;
      p.x += 0.3;
      tr.update(p, t, 0.8, ['c0', 'c1']);
    }
    const id = tr.tick(t)[0].objectId;
    // Muette 300 ms, puis vue à 8 m (hors du seuil statistique).
    t += 300000;
    p.x += 8;
    for (let i = 0; i < 4; i++) {
      tr.update(p, t, 0.8, ['c0', 'c1']);
      t += 40000;
      p.x += 0.3;
    }
    const after = tr.tick(t - 40000);
    expect(after).toHaveLength(1);
    expect(after[0].objectId).toBe(id);
  });

  it('uses the measurement covariance to gate confirmed tracks', () => {
    const tr = new Tracker(cfg);
    let t = 0;
    const p = { x: 0, y: 20, z: 5 };
    const tight = [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01];
    for (let i = 0; i < 10; i++) {
      t += 40000;
      tr.update(p, t, 0.8, ['c0', 'c1'], tight);
    }
    const id = tr.tick(t)[0].objectId;
    t += 40000;
    // 3 m d'écart avec une mesure précise à 10 cm : c'est un autre objet.
    tr.update({ x: 3, y: 20, z: 5 }, t, 0.8, ['c0', 'c1'], tight);
    const [track] = tr.tick(t);
    expect(track.objectId).toBe(id);
    expect(Math.abs(track.x)).toBeLessThan(0.5);
  });
});
