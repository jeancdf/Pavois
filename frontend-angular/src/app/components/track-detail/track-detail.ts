import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { TrackSelectionService } from '../../services/track-selection.service';
import { ObjectClassification, TrackUpdate } from '../../models/track-update.model';

const HISTORY_LENGTH = 20;

const CLASSIF_LABELS: Record<ObjectClassification, string> = {
  drone:    'DRONE',
  airplane: 'AVION',
  bird:     'OISEAU',
  other:    '?',
};

@Component({
  selector: 'app-track-detail',
  imports: [],
  templateUrl: './track-detail.html',
  styleUrl: './track-detail.css',
})
export class TrackDetailPanel implements OnDestroy {
  readonly selection = inject(TrackSelectionService);
  private readonly realtime = inject(RealtimeService);

  readonly latestUpdate = signal<TrackUpdate | null>(null);
  readonly history = signal<TrackUpdate[]>([]);

  private sub: Subscription;

  constructor() {
    // Réinitialise l'historique quand on change de piste sélectionnée
    effect(() => {
      this.selection.selectedTrackId(); // tracked
      this.latestUpdate.set(null);
      this.history.set([]);
    });

    this.sub = this.realtime.trackUpdates$.subscribe((update) => {
      if (update.trackId !== this.selection.selectedTrackId()) return;
      this.latestUpdate.set(update);
      this.history.update((h) => [update, ...h].slice(0, HISTORY_LENGTH));
    });
  }

  classifLabel(c?: ObjectClassification): string {
    return c ? (CLASSIF_LABELS[c] ?? '?') : '?';
  }

  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
