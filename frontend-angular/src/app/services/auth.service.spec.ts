import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('pavois_token');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('pavois_token');
  });

  it('rejects an invented token and stays logged out', async () => {
    const attempt = service.login('nimporte-quoi');
    const req = http.expectOne(`${environment.apiUrl}/auth/verify`);
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer nimporte-quoi',
    );
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );

    await expect(attempt).rejects.toThrow('jeton refusé');
    expect(service.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('pavois_token')).toBeNull();
  });

  it('explains a 502 while the backend restarts', async () => {
    const attempt = service.login('dev-pavois-token');
    const req = http.expectOne(`${environment.apiUrl}/auth/verify`);
    req.flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    await expect(attempt).rejects.toThrow(
      'backend en redémarrage, réessaie dans 10 s',
    );
    expect(service.isAuthenticated()).toBe(false);
  });

  it('opens the session only after the backend accepts the token', async () => {
    const attempt = service.login('dev-pavois-token');
    const req = http.expectOne(`${environment.apiUrl}/auth/verify`);
    req.flush({ ok: true });
    await attempt;

    expect(service.isAuthenticated()).toBe(true);
    expect(localStorage.getItem('pavois_token')).toBe('dev-pavois-token');
  });
});
