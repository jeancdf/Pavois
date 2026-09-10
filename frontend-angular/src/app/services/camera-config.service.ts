import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { CameraGpsConfig } from '../config/cameras.config';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

export type CameraPositionUpdate = Pick<CameraGpsConfig, 'lat' | 'lon' | 'alt'>;

@Injectable({ providedIn: 'root' })
export class CameraConfigService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);

  /**
   * Enregistre la position côté backend, qui la diffuse ensuite à tous les clients.
   * En cas d'échec, rejette avec un message destiné à l'opérateur.
   */
  async updatePosition(id: string, position: CameraPositionUpdate): Promise<CameraGpsConfig> {
    let updated: CameraGpsConfig;
    try {
      updated = await firstValueFrom(
        this.http.put<CameraGpsConfig>(
          `${environment.apiUrl}/cameras/${encodeURIComponent(id)}/position`,
          position,
          { headers: { Authorization: `Bearer ${this.auth.getToken() ?? ''}` } },
        ),
      );
    } catch (error) {
      throw new Error(describeUpdateError(error));
    }

    // Sans attendre la diffusion WebSocket, qui peut être coupée
    this.realtime.cameraConfigs.update((configs) =>
      configs.map((config) => (config.id === updated.id ? updated : config)),
    );
    return updated;
  }
}

function describeUpdateError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'erreur inattendue';
  switch (error.status) {
    case 0:
      return 'backend injoignable';
    case 401:
      return 'jeton refusé';
    case 403:
      return 'adresse IP non autorisée';
    default:
      return typeof error.error?.message === 'string'
        ? error.error.message
        : `erreur HTTP ${error.status}`;
  }
}
