import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { FixedExpense, Frequency } from '../../core/models/models';
import { SortBarComponent, SortDir } from '../../shared/sort-bar/sort-bar.component';
import { SearchBoxComponent } from '../../shared/search-box/search-box.component';
import { matchesSearch } from '../../core/services/search';
import { formatEUR } from '../../core/services/format';
import { FREQUENCIES, monthlyShare } from '../../core/services/fixed-expense';
import { DialogService } from '../../shared/confirm-dialog/dialog.service';

interface NewFixedForm {
  name: string;
  amount: number | null;
  /** Catégorie ou virement, d'une seule liste : '' (sans catégorie), l'identifiant d'une catégorie, ou 'transfer:<identifiant du compte>'. */
  dest: string;
  frequency: Frequency;
  payment_day: number | null;
}

const TRANSFER_PREFIX = 'transfer:';

function emptyForm(): NewFixedForm {
  return { name: '', amount: null, dest: '', frequency: 'monthly', payment_day: null };
}

/** Valeur de la liste « Catégorie ou virement » pour une dépense fixe enregistrée. */
function destOf(f: FixedExpense): string {
  return f.transfer_account_id ? TRANSFER_PREFIX + f.transfer_account_id : (f.category_id ?? '');
}

const NEEDS_DAY = 'Un virement fixe a besoin d\'un jour de prélèvement (de 1 à 31) : un virement a toujours une date.';

@Component({
  selector: 'app-fixed-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule, SortBarComponent, SearchBoxComponent],
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
        return asc ? 'du 1er au 31, sans jour à la fin' : 'du 31 au 1er, sans jour à la fin';
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
    // Sans jour de prélèvement : toujours en fin de liste, quel que soit le sens du tri.
    const byDay = (a: FixedExpense, b: FixedExpense) => {
      if (a.payment_day === null && b.payment_day === null) return 0;
      if (a.payment_day === null) return 1;
      if (b.payment_day === null) return -1;
      return sign * (a.payment_day - b.payment_day);
    };
    return [...list].sort((a, b) => (key === 'name' ? sign * byName(a, b) : byDay(a, b) || byName(a, b)));
  });

  // Recherche par nom (affichage seulement) : le total actif reste calculé sur toute la liste
  query = signal('');
  visibleFixed = computed<FixedExpense[]>(() =>
    this.sortedFixed().filter((f) => matchesSearch(f.name, this.query()))
  );
  searchInfo = computed(() => `${this.visibleFixed().length} sur ${this.data.fixedExpenses().length}`);

  toggleSort(key: 'name' | 'day') {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  private dialog = inject(DialogService);

  destOf = destOf;
  transferPrefix = TRANSFER_PREFIX;

  /** Comptes vers lesquels une dépense fixe du compte affiché peut virer : les autres comptes actifs. */
  otherAccounts = computed(() =>
    this.data.accounts().filter((a) => a.status === 'active' && a.id !== this.data.currentAccountId())
  );

  /** Compte de destination déjà enregistré mais qui n'est plus proposé (clôturé), pour le montrer au lieu de l'effacer. */
  staleTransferAccount(f: FixedExpense) {
    if (!f.transfer_account_id) return null;
    if (this.otherAccounts().some((a) => a.id === f.transfer_account_id)) return null;
    return this.data.accounts().find((a) => a.id === f.transfer_account_id) ?? null;
  }

  /** Découpe la valeur de la liste en catégorie ou compte de destination. */
  private parseDest(dest: string): { category_id: string | null; transfer_account_id: string | null } {
    if (dest.startsWith(TRANSFER_PREFIX)) return { category_id: null, transfer_account_id: dest.slice(TRANSFER_PREFIX.length) };
    return { category_id: dest || null, transfer_account_id: null };
  }

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
    if (!validDay(f.payment_day)) {
      this.error.set('Le jour de prélèvement doit être un entier de 1 à 31, ou rester vide.');
      return;
    }
    const dest = this.parseDest(f.dest);
    if (dest.transfer_account_id && f.payment_day === null) {
      this.error.set(NEEDS_DAY);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.data.addFixedExpense({
        name: f.name.trim(),
        amount: Math.abs(f.amount),
        category_id: dest.category_id,
        transfer_account_id: dest.transfer_account_id,
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

  /** Liste « Catégorie ou virement » d'une ligne : choisir un compte en fait un virement fixe (sans catégorie). */
  async updateDest(f: FixedExpense, select: HTMLSelectElement) {
    const dest = this.parseDest(select.value);
    this.error.set(null);
    if (dest.transfer_account_id && f.payment_day === null) {
      select.value = destOf(f);
      this.error.set(NEEDS_DAY);
      return;
    }
    try {
      await this.data.updateFixedExpense(f.id, dest);
    } catch (e: any) {
      select.value = destOf(f);
      this.error.set(e?.message ?? 'Erreur lors du changement.');
    }
  }

  async updateFrequency(id: string, value: Frequency) {
    this.error.set(null);
    try {
      await this.data.updateFixedExpense(id, { frequency: value });
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors du changement de fréquence.');
    }
  }

  /** Jour vide = pas de date. Un jour invalide est refusé (et l'ancienne valeur réaffichée), jamais corrigé en douce. */
  async updateDay(id: string, input: HTMLInputElement) {
    const raw = input.value.trim();
    const old = this.data.fixedExpenses().find((f) => f.id === id)?.payment_day ?? null;
    const n = raw === '' ? null : Number(raw);
    if (!validDay(n)) {
      input.value = old === null ? '' : String(old);
      this.error.set('Le jour de prélèvement doit être un entier de 1 à 31, ou rester vide.');
      return;
    }
    const current = this.data.fixedExpenses().find((f) => f.id === id);
    if (n === null && current?.transfer_account_id) {
      input.value = old === null ? '' : String(old);
      this.error.set(NEEDS_DAY);
      return;
    }
    this.error.set(null);
    try {
      await this.data.updateFixedExpense(id, { payment_day: n });
    } catch (e: any) {
      input.value = old === null ? '' : String(old);
      this.error.set(e?.message ?? 'Erreur lors du changement de jour.');
    }
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

/** Jour de prélèvement valide : vide (null) ou entier de 1 à 31. */
function validDay(n: number | null): boolean {
  return n === null || (Number.isInteger(n) && n >= 1 && n <= 31);
}
