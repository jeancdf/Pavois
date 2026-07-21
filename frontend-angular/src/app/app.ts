import { Component } from '@angular/core';
import { TopBar } from './components/top-bar/top-bar';
import { Sidebar } from './components/sidebar/sidebar';
import { DetectionFeed } from './components/detection-feed/detection-feed';
import { MapView } from './components/map/map';
import { TrackFeed } from './components/track-feed/track-feed';

@Component({
  selector: 'app-root',
  imports: [TopBar, Sidebar, DetectionFeed, MapView, TrackFeed],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
