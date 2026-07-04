import { Component, inject } from '@angular/core';
import { RealtimeService } from '../../services/realtime.service';

@Component({
  selector: 'app-sidebar',
  imports: [],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly realtime = inject(RealtimeService);
  readonly cameras = this.realtime.cameras;
}
