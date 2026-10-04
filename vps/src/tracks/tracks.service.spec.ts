import { NotFoundException } from '@nestjs/common';
import { TracksService } from './tracks.service';
import { JsonlTrackStore } from '../stores/jsonl-track.store';
import { TrackVerdict } from './track-types';
import * as fs from 'fs';
import * as path from 'path';

describe('TracksService with JsonlTrackStore', () => {
  let store: JsonlTrackStore;
  let service: TracksService;
  const testDataDir = path.resolve('./test-data-tracks');

  beforeEach(async () => {
    process.env.ALERTS_DATA_DIR = testDataDir;
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }

    store = new JsonlTrackStore();
    await store.onModuleInit();
    service = new TracksService(store);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorer
    }
  });

  it('records a track with the wire field names mapped to the schema', async () => {
    await service.record({
      trackId: 'obj1',
      lat: 48.8,
      lng: 2.3,
      alt: 58.5,
      classification: 'drone',
      timestamp: 1234,
    });

    const tracks = await service.list();
    expect(tracks.length).toBe(1);
    expect(tracks[0].trackId).toBe('obj1');
    expect(tracks[0].lat).toBe(48.8);
    expect(tracks[0].classification).toBe('drone');
  });

  it('never throws when persistence fails', async () => {
    jest.spyOn(store, 'create').mockRejectedValueOnce(new Error('disque indisponible'));
    await expect(
      service.record({
        trackId: 'obj1',
        lat: 0,
        lng: 0,
        alt: 0,
        timestamp: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('list() filters UNREVIEWED tracks correctly', async () => {
    await service.record({ trackId: 'obj1', lat: 0, lng: 0, alt: 0, timestamp: 0 });
    const tracks = await service.list({ verdict: 'UNREVIEWED' });
    expect(tracks.length).toBe(1);
    expect(tracks[0].verdict).toBeNull();
  });

  it('setVerdict() rejects an unknown id', async () => {
    await expect(
      service.setVerdict('missing-id', TrackVerdict.CONFIRMED),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setVerdict() stamps verdict and note', async () => {
    await service.record({ trackId: 'obj1', lat: 48.8, lng: 2.3, alt: 50, timestamp: 100 });
    const [track] = await service.list();
    expect(track).toBeDefined();

    const updated = await service.setVerdict(track.id, TrackVerdict.FALSE_POSITIVE, 'oiseau');
    expect(updated.verdict).toBe(TrackVerdict.FALSE_POSITIVE);
    expect(updated.verdictNote).toBe('oiseau');
  });
});
