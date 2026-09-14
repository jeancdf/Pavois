import { Component } from '@angular/core';
import { AlertFeed } from '../alert-feed/alert-feed';
import { DetectionFeed } from '../detection-feed/detection-feed';
import { MapView } from '../map/map';
import { TrackFeed } from '../track-feed/track-feed';

@Component({
  selector: 'app-dashboard',
  imports: [MapView, TrackFeed, DetectionFeed, AlertFeed],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardPage {}
