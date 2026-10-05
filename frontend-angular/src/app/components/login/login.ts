import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginScreen {
  private readonly auth = inject(AuthService);

  readonly tokenInput = signal('');
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly busy = computed(
    () => this.submitting() || this.auth.pending(),
  );

  async submit(): Promise<void> {
    const token = this.tokenInput().trim();
    if (!token) {
      this.error.set('Veuillez entrer un token de connexion.');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.auth.login(token);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'erreur inattendue',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
