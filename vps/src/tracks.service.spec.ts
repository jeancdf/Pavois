import { NotFoundException } from '@nestjs/common';
import { TracksService } from './tracks.service';
import { PrismaService } from './prisma.service';
import { TrackVerdict } from '@prisma/client';

function fakePrisma() {
  return {
    track: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
}

describe('TracksService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: TracksService;

  beforeEach(() => {
    prisma = fakePrisma();
    service = new TracksService(prisma as unknown as PrismaService);
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

    expect(prisma.track.create).toHaveBeenCalledWith({
      data: {
        trackId: 'obj1',
        lat: 48.8,
        lng: 2.3,
        alt: 58.5,
        classification: 'drone',
        timestampUs: 1234,
      },
    });
  });

  it('never throws when persistence fails: logging is not the critical path', async () => {
    prisma.track.create.mockRejectedValueOnce(new Error('connection refused'));
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

  it('list() translates the UNREVIEWED filter to verdict IS NULL', async () => {
    prisma.track.findMany.mockResolvedValueOnce([]);
    await service.list({ verdict: 'UNREVIEWED' });
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { verdict: null } }),
    );
  });

  it('list() clamps limit to the documented [1, 200] range', async () => {
    prisma.track.findMany.mockResolvedValue([]);
    await service.list({ limit: 10000 });
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
    await service.list({ limit: 0 });
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it('setVerdict() rejects an unknown id instead of silently upserting', async () => {
    prisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.setVerdict('missing-id', TrackVerdict.CONFIRMED),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.track.update).not.toHaveBeenCalled();
  });

  it('setVerdict() stamps reviewedAt and stores the verdict/note', async () => {
    prisma.track.findUnique.mockResolvedValueOnce({ id: 'abc' });
    prisma.track.update.mockResolvedValueOnce({ id: 'abc' });
    await service.setVerdict('abc', TrackVerdict.FALSE_POSITIVE, 'was a bird');
    const [call] = prisma.track.update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(call.where).toEqual({ id: 'abc' });
    expect(call.data.verdict).toBe(TrackVerdict.FALSE_POSITIVE);
    expect(call.data.reviewNote).toBe('was a bird');
    expect(call.data.reviewedAt).toBeInstanceOf(Date);
  });
});
