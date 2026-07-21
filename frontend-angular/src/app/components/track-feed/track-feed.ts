import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { TrackUpdate } from '../../models/track-update.model';

const MAX_ITEMS = 15;

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

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
