import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopBar } from './components/top-bar/top-bar';
import { Sidebar } from './components/sidebar/sidebar';
import { LoginScreen } from './components/login/login';
import { ToastContainer } from './components/toast/toast';
import { TrackDetailPanel } from './components/track-detail/track-detail';
import { AuthService } from './services/auth.service';
import { TrackSelectionService } from './services/track-selection.service';
import { AlertTriggerService } from './services/alert-trigger.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    TopBar,
    Sidebar,
    LoginScreen,
    ToastContainer,
    TrackDetailPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);
  readonly trackSelection = inject(TrackSelectionService);

  private readonly _alertTrigger = inject(AlertTriggerService);
}
