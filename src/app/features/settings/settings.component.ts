import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
    this.initialBalanceInput.set(this.data.settings()?.initial_balance ?? 0);
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

  // ------------------------------------------------------------
  // Import depuis Excel (fichier JSON produit par scripts/excel_to_json.py)
  // ------------------------------------------------------------
  importing = signal(false);
  importInfo = signal<string | null>(null);
  importError = signal<string | null>(null);

  async onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing.set(true);
    this.importInfo.set(null);
    this.importError.set(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload.categories) || !Array.isArray(payload.transactions)) {
        throw new Error("Ce fichier ne ressemble pas à un export généré par excel_to_json.py.");
      }
      await this.data.importFromJson(payload);
      this.importInfo.set(
        `Import terminé : ${payload.categories.length} catégories, ${payload.fixedExpenses?.length ?? 0} dépenses fixes, ${payload.months?.length ?? 0} mois, ${payload.transactions.length} transactions.`
      );
    } catch (e: any) {
      this.importError.set(e?.message ?? "Erreur lors de l'import.");
    } finally {
      this.importing.set(false);
      input.value = '';
    }
  }
}
