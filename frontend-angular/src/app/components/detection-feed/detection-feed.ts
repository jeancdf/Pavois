import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { DetectionService } from '../../services/detection.service';
import { RawDetection } from '../../models/raw-detection.model';

const MAX_ITEMS = 10;

@Component({
  selector: 'app-detection-feed',
  imports: [],
  templateUrl: './detection-feed.html',
  styleUrl: './detection-feed.css',
})
export class DetectionFeed implements OnDestroy {
  private readonly detectionService = inject(DetectionService);
  private readonly subscription: Subscription;

  readonly connected = this.detectionService.connected;
  readonly items = signal<RawDetection[]>([]);

  constructor() {
    this.subscription = this.detectionService.detections$.subscribe((detection) => {
      this.items.update((current) => [detection, ...current].slice(0, MAX_ITEMS));
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
