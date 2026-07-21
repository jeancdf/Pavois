import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { ObjectClassification, TrackUpdate } from '../../models/track-update.model';

const MAX_ITEMS = 15;

const CLASSIF_LABELS: Record<ObjectClassification, string> = {
  drone:    'DRONE',
  airplane: 'AVION',
  bird:     'OISEAU',
  other:    '?',
};

@Component({
  selector: 'app-track-feed',
  imports: [],
  templateUrl: './track-feed.html',
  styleUrl: './track-feed.css',
})
export class TrackFeed implements OnDestroy {
  private readonly realtime = inject(RealtimeService);
  private readonly subscription: Subscription;

  readonly items = signal<TrackUpdate[]>([]);

  constructor() {
    this.subscription = this.realtime.trackUpdates$.subscribe((track) => {
      this.items.update((current) => [track, ...current].slice(0, MAX_ITEMS));
    });
  }

  classifLabel(c?: ObjectClassification): string {
    return c ? (CLASSIF_LABELS[c] ?? '?') : '?';
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
