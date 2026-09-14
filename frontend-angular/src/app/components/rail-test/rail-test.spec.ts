import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Component, signal } from '@angular/core';
import { routes } from '../../app.routes';
import { RailTestPage } from './rail-test';
import { RailVolume } from '../rail-volume/rail-volume';
import { RailBenchService } from '../../services/rail-bench.service';
import { RealtimeService } from '../../services/realtime.service';
import { NotificationService } from '../../services/notification.service';
import { buildRailBenchState } from '../../config/rail-bench';

@Component({
  selector: 'app-rail-volume',
  template: '<div class="volume-stub"></div>',
})
class RailVolumeStub {}

describe('RailTestPage', () => {
  const bench = buildRailBenchState({ rangeM: 2.5 });
  const railBench = signal(bench);
  const fuseUpdate = signal({
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
    tracks: [],
  });
  const lastDetectionAt = signal<Record<string, number>>({
    jean: Date.now(),
  });
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
            lastDetectionAt,
            statsOf: (id: string) => stats[id as keyof typeof stats],
            previewOf: () => undefined,
          },
        },
        NotificationService,
      ],
    })
      .overrideComponent(RailTestPage, {
        remove: { imports: [RailVolume] },
        add: { imports: [RailVolumeStub] },
      })
      .compileComponents();
  });

  it('shows Pi fps and the live 3D error on /test-rail', async () => {
    const fixture = TestBed.createComponent(RailTestPage);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TEST RAIL');
    expect(text).toContain('18.2 fps');
    expect(text).toContain('jean');
    expect(text).toContain('0.10 m');
  });
});
