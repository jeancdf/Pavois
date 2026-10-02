import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { Component, input, signal } from '@angular/core';
import { routes } from '../../app.routes';
import { RailTestPage } from './rail-test';
import { RailVolume } from '../rail-volume/rail-volume';
import { TuningPanel } from '../tuning-panel/tuning-panel';
import { RailBenchService } from '../../services/rail-bench.service';
import { RealtimeService } from '../../services/realtime.service';
import { NotificationService } from '../../services/notification.service';
import { buildRailBenchState } from '../../config/rail-bench';
import type { FuseUpdate } from '../../models/fuse-update.model';
import type { ClassificationReview } from '../../models/target-classification.model';

@Component({
  selector: 'app-rail-volume',
  template: '<div class="volume-stub"></div>',
})
class RailVolumeStub {
  readonly bench = input<unknown>();
  readonly tracks = input<unknown[]>([]);
}

@Component({
  selector: 'app-tuning-panel',
  template: '<div class="tuning-stub"></div>',
})
class TuningPanelStub {}

describe('RailTestPage', () => {
  const bench = buildRailBenchState({ rangeM: 2.5 });
  const railBench = signal(bench);
  const fuseUpdate = signal<FuseUpdate>({
    type: 'fuse_update' as const,
    lastFuse: {
      ok: true,
      rejectReason: null,
      residualM: 0.05,
      parallaxDeg: 10,
      confidence: 0.9,
      cameras: ['jean', 'tanel'],
      point: { x: 0, y: 2.6, z: 0.4 },
    },
    rawIntersections: [
      {
        point: { x: 0, y: 2.6, z: 0.4 },
        residualM: 0.05,
        parallaxDeg: 8,
        cameras: ['jean', 'tanel'],
        timestampUs: 1_000_000,
      },
    ],
    tracks: [],
  });
  const lastDetectionAt = signal<Record<string, number>>({
    jean: Date.now(),
  });
  const targetClassification = signal(null);
  const classificationReview = signal<ClassificationReview | null>(null);
  const stats = {
    jean: {
      type: 'camera_stats' as const,
      cameraId: 'jean',
      fps: 18.2,
      frameIndex: 40,
      timestamp: 1,
      receivedAt: Date.now(),
    },
  };

  beforeEach(async () => {
    classificationReview.set(null);
    await TestBed.configureTestingModule({
      imports: [RailTestPage],
      providers: [
        provideHttpClient(),
        provideRouter(routes),
        {
          provide: RailBenchService,
          useValue: {
            start: async () => bench,
            stop: async () => undefined,
            refresh: async () => undefined,
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            connected: signal(true),
            railBench,
            fuseUpdate,
            targetClassification,
            classificationReview,
            lastDetectionAt,
            statsOf: (id: string) => stats[id as keyof typeof stats],
            previewOf: () => undefined,
          },
        },
        NotificationService,
      ],
    })
      .overrideComponent(RailTestPage, {
        remove: { imports: [RailVolume, TuningPanel] },
        add: { imports: [RailVolumeStub, TuningPanelStub] },
      })
      .compileComponents();
  });

  it('shows the last AI image and its scaled detection box', () => {
    classificationReview.set({
      type: 'classification_review',
      requestId: 'request-1',
      createdAt: Date.now(),
      images: [
        {
          cameraId: 'jean',
          mime: 'image/jpeg',
          jpegBase64: '/9j/2Q==',
          capturedUs: 1,
          frameId: 2,
          width: 100,
          height: 50,
          vote: {
            cameraId: 'jean',
            label: 'drone',
            confidence: 0.8,
            reason: 'non_human_sharp_motion',
            boxes: [
              {
                label: 'drone',
                confidence: 0.8,
                x: 10,
                y: 5,
                width: 20,
                height: 10,
              },
            ],
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RailTestPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Dernières photos IA');
    expect(root.textContent).toContain('drone 80%');
    const box = root.querySelector<HTMLElement>('.detection-box');
    expect(box?.style.left).toBe('10%');
    expect(box?.style.top).toBe('10%');
    expect(box?.style.width).toBe('20%');
    expect(box?.style.height).toBe('20%');
  });

  it('shows Pi fps and the fused target error', async () => {
    const fixture = TestBed.createComponent(RailTestPage);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TEST RAIL');
    expect(text).toContain('18.2 fps');
    expect(text).toContain('jean');
    expect(text).toContain('Cible suivie');
    expect(text).toContain('Écart 0.10 m');
  });

  it('hands every fused track to the 3D volume', () => {
    const single = fuseUpdate();
    const track = {
      timestampUs: 1_000_000,
      confidence: 0.9,
      cameras: ['jean', 'tanel', 'walid'],
      classification: 'other',
    };
    fuseUpdate.set({
      ...single,
      tracks: [
        { ...track, objectId: 6, x: -0.2, y: 1.1, z: 0.4 },
        { ...track, objectId: 36, x: 0.1, y: 1.2, z: 0.3 },
      ],
    });
    try {
      const fixture = TestBed.createComponent(RailTestPage);
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Pistes 2');
      const volume = fixture.debugElement.query(By.directive(RailVolumeStub))
        .componentInstance as RailVolumeStub;
      expect(volume.tracks()).toHaveLength(2);
    } finally {
      fuseUpdate.set(single);
    }
  });

  it('opens the settings panel beside the scene on demand', () => {
    const fixture = TestBed.createComponent(RailTestPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Réglages',
    )!;
    expect(root.querySelector('app-tuning-panel')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    fixture.detectChanges();
    expect(root.querySelector('.rail-body app-tuning-panel')).not.toBeNull();
    expect(root.querySelector('.rail-body app-rail-volume')).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    fixture.detectChanges();
    expect(root.querySelector('app-tuning-panel')).toBeNull();
  });
});
