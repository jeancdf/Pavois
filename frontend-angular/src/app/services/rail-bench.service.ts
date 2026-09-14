import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  RailBenchOptions,
  RailBenchState,
} from '../config/rail-bench';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

interface RailBenchPayload {
  active: boolean;
  bench: RailBenchState | null;
}

@Injectable({ providedIn: 'root' })
export class RailBenchService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);

  async start(options: RailBenchOptions = {}): Promise<RailBenchState> {
    try {
      const bench = await firstValueFrom(
        this.http.post<RailBenchState>(
          `${environment.apiUrl}/bench/rail`,
          options,
          { headers: this.headers() },
        ),
      );
      this.realtime.railBench.set(bench);
      return bench;
    } catch (error) {
      throw new Error(describeBenchError(error));
    }
  }

  async stop(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete<RailBenchPayload>(`${environment.apiUrl}/bench/rail`, {
          headers: this.headers(),
        }),
      );
      this.realtime.railBench.set(null);
    } catch (error) {
      throw new Error(describeBenchError(error));
    }
  }

  async refresh(): Promise<void> {
    try {
      const payload = await firstValueFrom(
        this.http.get<RailBenchPayload>(`${environment.apiUrl}/bench/rail`, {
          headers: this.headers(),
        }),
      );
      this.realtime.railBench.set(payload.bench);
    } catch (error) {
      throw new Error(describeBenchError(error));
    }
  }

  private headers(): { Authorization: string } {
    return { Authorization: `Bearer ${this.auth.getToken() ?? ''}` };
  }
}

function describeBenchError(error: unknown): string {
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
