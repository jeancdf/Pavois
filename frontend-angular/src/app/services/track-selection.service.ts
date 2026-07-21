import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TrackSelectionService {
  private readonly _selectedTrackId = signal<string | null>(null);
  readonly selectedTrackId = this._selectedTrackId.asReadonly();

  select(trackId: string): void {
    this._selectedTrackId.set(trackId);
  }

  deselect(): void {
    this._selectedTrackId.set(null);
  }
}
