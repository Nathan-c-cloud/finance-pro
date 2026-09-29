import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { FixedExpense, Frequency } from '../../core/models/models';
import { SortBarComponent, SortDir } from '../../shared/sort-bar/sort-bar.component';
import { formatEUR } from '../../core/services/format';
import { FREQUENCIES, monthlyShare } from '../../core/services/fixed-expense';
import { DialogService } from '../../shared/confirm-dialog/dialog.service';

interface NewFixedForm {
  name: string;
  amount: number | null;
  category_id: string | null;
  frequency: Frequency;
  payment_day: number;
}

function emptyForm(): NewFixedForm {
  return { name: '', amount: null, category_id: null, frequency: 'monthly', payment_day: 1 };
}

@Component({
  selector: 'app-fixed-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule, SortBarComponent],
  templateUrl: './fixed-expenses.component.html',
  styleUrl: './fixed-expenses.component.scss',
})
export class FixedExpensesComponent {
  formatEUR = formatEUR;
  monthlyShare = monthlyShare;
  frequencies = FREQUENCIES;
  form = signal<NewFixedForm>(emptyForm());
  saving = signal(false);
  error = signal<string | null>(null);

  // Tri de la liste (affichage seulement). Sans choix : ordre de création.
  sortOptions = [
    { key: 'name', label: 'Nom' },
    { key: 'day', label: 'Jour de prélèvement' },
  ];
  sortKey = signal<'name' | 'day' | null>(null);
  sortDir = signal<SortDir>('asc');
  sortHint = computed(() => {
    const asc = this.sortDir() === 'asc';
    switch (this.sortKey()) {
      case 'name':
        return asc ? 'de A à Z' : 'de Z à A';
      case 'day':
        return asc ? 'du 1er au 28' : 'du 28 au 1er';
      default:
        return 'ordre de création';
    }
  });
  sortedFixed = computed<FixedExpense[]>(() => {
    const key = this.sortKey();
    const list = this.data.fixedExpenses();
    if (!key) return list;
    const sign = this.sortDir() === 'asc' ? 1 : -1;
    const byName = (a: FixedExpense, b: FixedExpense) =>
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });
    return [...list].sort((a, b) =>
      key === 'name' ? sign * byName(a, b) : sign * (a.payment_day - b.payment_day) || byName(a, b)
    );
  });

  toggleSort(key: 'name' | 'day') {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  private dialog = inject(DialogService);

  constructor(public data: DataService) {}

  /** Total actif ramené au mois : chaque dépense compte pour sa part mensuelle. */
  get total() {
    return this.data
      .fixedExpenses()
      .filter((f) => f.active)
      .reduce((acc, f) => acc + monthlyShare(f.amount, f.frequency), 0);
  }

  updateFormField<K extends keyof NewFixedForm>(key: K, value: NewFixedForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async add() {
    const f = this.form();
    if (!f.name.trim() || f.amount === null) {
      this.error.set('Merci de renseigner au moins le nom et le montant.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.data.addFixedExpense({
        name: f.name.trim(),
        amount: Math.abs(f.amount),
        category_id: f.category_id,
        frequency: f.frequency,
        payment_day: f.payment_day,
        active: true,
      });
      this.form.set(emptyForm());
    } catch (e: any) {
      this.error.set(e?.message ?? "Erreur lors de l'ajout.");
    } finally {
      this.saving.set(false);
    }
  }

  async updateName(id: string, value: string) {
    if (value.trim()) await this.data.updateFixedExpense(id, { name: value.trim() });
  }

  async updateAmount(id: string, value: string) {
    const n = parseFloat(value.replace(',', '.'));
    if (!isNaN(n)) await this.data.updateFixedExpense(id, { amount: Math.abs(n) });
  }

  async updateCategory(id: string, value: string) {
    await this.data.updateFixedExpense(id, { category_id: value || null });
  }

  async updateFrequency(id: string, value: Frequency) {
    this.error.set(null);
    try {
      await this.data.updateFixedExpense(id, { frequency: value });
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors du changement de fréquence.');
    }
  }

  async updateDay(id: string, value: string) {
    const n = parseInt(value, 10);
    if (!isNaN(n)) await this.data.updateFixedExpense(id, { payment_day: Math.min(Math.max(n, 1), 28) });
  }

  async toggleActive(id: string, current: boolean) {
    await this.data.updateFixedExpense(id, { active: !current });
  }

  async remove(id: string) {
    const ok = await this.dialog.confirm({
      title: 'Supprimer cette dépense fixe ?',
      message: 'Elle sera retirée du référentiel. Les mois déjà créés ne seront pas modifiés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await this.data.deleteFixedExpense(id);
  }
}
