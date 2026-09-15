import {
  ClassificationService,
  voteClassifications,
} from './classification.service';
import type { ClassificationVote } from './classification.types';

describe('classification vote', () => {
  it('requires two agreeing drone views', () => {
    const votes: ClassificationVote[] = [
      { cameraId: 'jean', label: 'drone', confidence: 0.8 },
      { cameraId: 'tanel', label: 'drone', confidence: 0.7 },
      { cameraId: 'walid', label: 'unknown', confidence: 0.1 },
    ];
    expect(voteClassifications(votes)).toEqual({
      label: 'drone',
      confidence: 0.75,
    });
  });

  it('prioritizes a two-camera human veto', () => {
    const votes: ClassificationVote[] = [
      { cameraId: 'jean', label: 'human', confidence: 0.9 },
      { cameraId: 'tanel', label: 'drone', confidence: 0.8 },
      { cameraId: 'walid', label: 'human', confidence: 0.7 },
    ];
    expect(voteClassifications(votes).label).toBe('human');
  });

  it('returns unknown on disagreement', () => {
    const votes: ClassificationVote[] = [
      { cameraId: 'jean', label: 'human', confidence: 0.9 },
      { cameraId: 'tanel', label: 'drone', confidence: 0.9 },
      { cameraId: 'walid', label: 'unknown', confidence: 0 },
    ];
    expect(voteClassifications(votes)).toEqual({
      label: 'unknown',
      confidence: 0,
    });
  });
});

describe('ClassificationService trigger', () => {
  const previousCameraIds = process.env.CLASSIFICATION_CAMERA_IDS;

  afterAll(() => {
    if (previousCameraIds === undefined) {
      delete process.env.CLASSIFICATION_CAMERA_IDS;
    } else {
      process.env.CLASSIFICATION_CAMERA_IDS = previousCameraIds;
    }
  });

  it('starts one three-camera request for a close fused point', () => {
    process.env.CLASSIFICATION_CAMERA_IDS = 'jean,tanel,walid';
    const broadcast = jest.fn();
    const service = new ClassificationService({ broadcast } as never);
    const fuse = {
      ok: true,
      rejectReason: null,
      residualM: 0.1,
      parallaxDeg: 5,
      confidence: 0.8,
      cameras: ['jean', 'tanel'],
      point: { x: 0, y: 2, z: 0.5 },
    };
    const trigger = service.considerFusion(
      fuse,
      ['jean', 'tanel', 'walid'],
      1000,
    );
    expect(trigger?.cameraIds).toEqual(['jean', 'tanel', 'walid']);
    expect(service.considerFusion(fuse, trigger!.cameraIds, 1010)).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(
      'target_classification',
      expect.objectContaining({
        status: 'pending',
        cameras: trigger!.cameraIds,
      }),
    );
    service.onModuleDestroy();
  });

  it('does not trigger until every Pi endpoint is online', () => {
    const service = new ClassificationService({
      broadcast: jest.fn(),
    } as never);
    const fuse = {
      ok: true,
      rejectReason: null,
      residualM: 0.1,
      parallaxDeg: 5,
      confidence: 0.8,
      cameras: ['jean', 'tanel'],
      point: { x: 0, y: 2, z: 0.5 },
    };
    expect(service.considerFusion(fuse, ['jean', 'tanel'], 1000)).toBeNull();
    service.onModuleDestroy();
  });
});
