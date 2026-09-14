import { Component, inject } from '@angular/core';
import { TopBar } from './components/top-bar/top-bar';
import { Sidebar } from './components/sidebar/sidebar';
import { DetectionFeed } from './components/detection-feed/detection-feed';
import { MapView } from './components/map/map';
import { TrackFeed } from './components/track-feed/track-feed';
import { AlertFeed } from './components/alert-feed/alert-feed';
import { LoginScreen } from './components/login/login';
import { ToastContainer } from './components/toast/toast';
import { TrackDetailPanel } from './components/track-detail/track-detail';
import { AuthService } from './services/auth.service';
import { TrackSelectionService } from './services/track-selection.service';
import { AlertTriggerService } from './services/alert-trigger.service';

@Component({
  selector: 'app-root',
  imports: [TopBar, Sidebar, DetectionFeed, MapView, TrackFeed, AlertFeed, LoginScreen, ToastContainer, TrackDetailPanel],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  readonly trackSelection = inject(TrackSelectionService);

  // Injecté pour forcer son initialisation (abonnements aux events WS)
  private readonly _alertTrigger = inject(AlertTriggerService);
}
