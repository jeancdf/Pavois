import { Component } from '@angular/core';
import { TopBar } from './components/top-bar/top-bar';
import { Sidebar } from './components/sidebar/sidebar';
import { DetectionFeed } from './components/detection-feed/detection-feed';

@Component({
  selector: 'app-root',
  imports: [TopBar, Sidebar, DetectionFeed],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
