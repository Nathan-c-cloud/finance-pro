import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss',
})
export class AuthComponent {
  mode = signal<'login' | 'signup'>('login');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  loading = signal(false);
  error = signal<string | null>(null);
  info = signal<string | null>(null);
  showPassword = signal(false);
  showConfirmPassword = signal(false);

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  toggleMode() {
    this.mode.set(this.mode() === 'login' ? 'signup' : 'login');
    this.error.set(null);
    this.info.set(null);
  }

  async submit() {
    this.error.set(null);
    this.info.set(null);

    const email = this.email().trim();
    const password = this.password();

    if (!email || !password) {
      this.error.set('Merci de renseigner ton email et ton mot de passe.');
      return;
    }

    if (this.mode() === 'signup' && password !== this.confirmPassword()) {
      this.error.set('Les deux mots de passe ne correspondent pas.');
      return;
    }

    if (password.length < 6) {
      this.error.set('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }

    this.loading.set(true);
    try {
      if (this.mode() === 'login') {
        const { error } = await this.supabase.signInWithPassword(email, password);
        if (error) {
          this.error.set(this.friendlyError(error.message));
          return;
        }
        this.router.navigateByUrl('/mois');
      } else {
        const { data, error } = await this.supabase.signUp(email, password);
        if (error) {
          this.error.set(this.friendlyError(error.message));
          return;
        }
        if (data.session) {
          // Confirmation email désactivée sur le projet Supabase : session immédiate.
          this.router.navigateByUrl('/mois');
        } else {
          this.info.set('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.');
          this.mode.set('login');
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  private friendlyError(message: string): string {
    if (message.includes('Invalid login credentials')) {
      return 'Email ou mot de passe incorrect.';
    }
    if (message.includes('already registered') || message.includes('User already registered')) {
      return 'Un compte existe déjà avec cet email.';
    }
    return message;
  }
}
