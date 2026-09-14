import { Routes } from '@angular/router';
import { DashboardPage } from './components/dashboard/dashboard';
import { RailTestPage } from './components/rail-test/rail-test';

export const routes: Routes = [
  { path: '', component: DashboardPage },
  { path: 'test-rail', component: RailTestPage },
  { path: '**', redirectTo: '' },
];
