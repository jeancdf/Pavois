import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'pavois_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _isAuthenticated = signal(false);
  private readonly _pending = signal(false);

  readonly isAuthenticated = this._isAuthenticated.asReadonly();
  readonly pending = this._pending.asReadonly();

  constructor() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      void this.restoreSession(stored);
    }
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /**
   * N'ouvre l'UI qu'après un 200 de GET /auth/verify.
   * Un jeton inventé reste rejeté.
   */
  async login(token: string): Promise<void> {
    try {
      await this.verifyToken(token);
    } catch (error) {
      throw new Error(describeAuthError(error));
    }
    this.persistToken(token);
  }

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    this._isAuthenticated.set(false);
  }

  private persistToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this._isAuthenticated.set(true);
  }

  private async restoreSession(token: string): Promise<void> {
    this._pending.set(true);
    try {
      await this.verifyToken(token);
      this._isAuthenticated.set(true);
    } catch {
      this.clearToken();
    } finally {
      this._pending.set(false);
    }
  }

  private verifyToken(token: string): Promise<unknown> {
    const url = `${environment.apiUrl}/auth/verify`;
    const headers = { Authorization: `Bearer ${token}` };
    return firstValueFrom(this.http.get(url, { headers }));
  }
}

function describeAuthError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'erreur inattendue';
  }
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
