import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { TuningState, TuningValues } from '../models/tuning.model';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

@Injectable({ providedIn: 'root' })
export class TuningService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly url = `${environment.apiUrl}/tuning`;
  private lastRequest = 0;

  refresh(): Promise<TuningState> {
    return this.send(this.http.get<TuningState>(this.url, this.options()));
  }

  setFusion(values: TuningValues): Promise<TuningState> {
    return this.send(this.http.put<TuningState>(`${this.url}/fusion`, { values }, this.options()));
  }

  resetFusion(): Promise<TuningState> {
    return this.send(this.http.delete<TuningState>(`${this.url}/fusion`, this.options()));
  }

  /** Sans liste de caméras : toutes. */
  setDetector(values: TuningValues, cameraIds?: string[]): Promise<TuningState> {
    return this.send(
      this.http.put<TuningState>(`${this.url}/detector`, { cameraIds, values }, this.options()),
    );
  }

  /** Rend la main au fichier de configuration du Pi ; sans caméra : tous. */
  resetDetector(cameraId?: string): Promise<TuningState> {
    return this.send(
      this.http.delete<TuningState>(`${this.url}/detector`, {
        ...this.options(),
        params: cameraId ? { cameraId } : {},
      }),
    );
  }

  applyPreset(id: string): Promise<TuningState> {
    return this.send(
      this.http.post<TuningState>(
        `${this.url}/presets/${encodeURIComponent(id)}/apply`,
        {},
        this.options(),
      ),
    );
  }

  savePreset(
    name: string,
    detector: TuningValues | null,
    fusion: TuningValues,
  ): Promise<TuningState> {
    return this.send(
      this.http.post<TuningState>(
        `${this.url}/presets`,
        { name, detector, fusion },
        this.options(),
      ),
    );
  }

  deletePreset(id: string): Promise<TuningState> {
    return this.send(
      this.http.delete<TuningState>(
        `${this.url}/presets/${encodeURIComponent(id)}`,
        this.options(),
      ),
    );
  }

  // Chaque réponse porte l'état complet. Un curseur que l'on fait glisser en
  // envoie plusieurs à la suite : seule la réponse à la dernière requête compte,
  // une plus ancienne ferait reculer le panneau.
  private async send(request: Observable<TuningState>): Promise<TuningState> {
    const id = ++this.lastRequest;
    let state: TuningState;
    try {
      state = await firstValueFrom(request);
    } catch (error) {
      throw new Error(describeTuningError(error));
    }
    if (id === this.lastRequest) this.realtime.tuning.set(state);
    return state;
  }

  private options(): { headers: { Authorization: string } } {
    return { headers: { Authorization: `Bearer ${this.auth.getToken() ?? ''}` } };
  }
}

function describeTuningError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'erreur inattendue';
  switch (error.status) {
    case 0:
      return 'backend injoignable';
    case 401:
      return 'jeton refusé';
    case 403:
      return 'adresse IP non autorisée';
    case 404:
      return typeof error.error?.message === 'string' && !error.error.message.startsWith('Cannot ')
        ? error.error.message
        : 'ce backend ne propose pas les réglages à chaud';
    case 429:
      return 'trop de requêtes, réessaie dans un instant';
    default:
      return typeof error.error?.message === 'string'
        ? error.error.message
        : `erreur HTTP ${error.status}`;
  }
}
