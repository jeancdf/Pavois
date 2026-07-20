import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginScreen {
  private readonly auth = inject(AuthService);

  readonly tokenInput = signal(environment.production ? '' : (environment.devToken ?? ''));
  readonly error = signal<string | null>(null);

  submit(): void {
    const token = this.tokenInput().trim();
    if (!token) {
      this.error.set('Veuillez entrer un token de connexion.');
      return;
    }
    this.error.set(null);
    this.auth.setToken(token);
  }
}
