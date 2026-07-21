import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'pavois_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _isAuthenticated = signal(false);
  readonly isAuthenticated = this._isAuthenticated.asReadonly();

  constructor() {
    const stored = localStorage.getItem(TOKEN_KEY);
    // En dev, pré-remplir avec le token de dev si aucun token n'est stocké
    if (!stored && !environment.production && environment.devToken) {
      localStorage.setItem(TOKEN_KEY, environment.devToken);
      this._isAuthenticated.set(true);
    } else {
      this._isAuthenticated.set(!!stored);
    }
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this._isAuthenticated.set(true);
  }

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    this._isAuthenticated.set(false);
  }
}
