import { Component, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ExcelExchangeComponent } from './excel-exchange.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ExcelExchangeComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  initialBalanceInput = signal<number | null>(null);
  saving = signal(false);
  info = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor(
    public data: DataService,
    public supabase: SupabaseService,
    private router: Router
  ) {
    // Suit la valeur enregistrée : sur un chargement direct de la page, les réglages arrivent après
    // la création du composant, et le champ affichait 0 (un clic sur Enregistrer l'aurait écrasée).
    effect(() => {
      const s = this.data.settings();
      if (s) this.initialBalanceInput.set(s.initial_balance);
    });
  }

  async saveInitialBalance() {
    const v = this.initialBalanceInput();
    if (v === null) return;
    this.saving.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      await this.data.updateInitialBalance(v);
      this.info.set('Solde initial mis à jour.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors de la sauvegarde.');
    } finally {
      this.saving.set(false);
    }
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigateByUrl('/connexion');
  }
}
