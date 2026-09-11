import { Test, TestingModule } from '@nestjs/testing';
import { FusionController } from './fusion.controller';
import { FusionService } from './fusion.service';
import type { FusionSnapshot } from './fusion.types';

describe('FusionController', () => {
  let controller: FusionController;

  const snapshot: FusionSnapshot = {
    activeCameras: 2,
    cameraCount: 2,
    historyWindowMs: 2000,
    staleAfterMs: 2000,
    cameras: [
      {
        cameraId: 'jean',
        detectionCount: 4,
        lastTimestampUs: 19128667926,
        lastReceivedAtMs: 1_725_000_000_000,
        ageMs: 40,
        active: true,
        hasPose: true,
        lastX: 551.93,
        lastY: 638.21,
        lastConfidence: 0.9,
      },
      {
        cameraId: 'tanel',
        detectionCount: 3,
        lastTimestampUs: 19128667900,
        lastReceivedAtMs: 1_725_000_000_000,
        ageMs: 120,
        active: true,
        hasPose: true,
        lastX: 400,
        lastY: 300,
        lastConfidence: 0.8,
      },
    ],
  };

  const fusion = {
    snapshot: jest.fn().mockReturnValue(snapshot),
  };

  beforeEach(async () => {
    fusion.snapshot.mockReset();
    fusion.snapshot.mockReturnValue(snapshot);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FusionController],
      providers: [
        { provide: FusionService, useValue: fusion },
      ],
    }).compile();

    controller = module.get(FusionController);
  });

  it('returns the fusion snapshot', () => {
    expect(controller.status()).toBe(snapshot);
    expect(fusion.snapshot).toHaveBeenCalledTimes(1);
  });
});
