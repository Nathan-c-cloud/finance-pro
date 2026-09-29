import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { Transaction, TxType } from '../../core/models/models';
import { formatEUR, formatPercent } from '../../core/services/format';
import { IconComponent } from '../../shared/icon/icon.component';
import { SortBarComponent, SortDir } from '../../shared/sort-bar/sort-bar.component';
import { BreakdownInput, buildBreakdown } from '../../core/services/breakdown';
import { DialogService } from '../../shared/confirm-dialog/dialog.service';

interface NewTxForm {
  type: TxType;
  name: string;
  amount: number | null;
  category_id: string | null;
  tx_date: string | null;
  detail: string;
  necessary: boolean | null;
  received: boolean | null;
}

function emptyForm(type: TxType): NewTxForm {
  return {
    type,
    name: '',
    amount: null,
    category_id: null,
    tx_date: null,
    detail: '',
    necessary: null,
    received: type === 'income' ? false : null,
  };
}

type SortKey = 'date' | 'name';

/** Tri stable : à critère égal, l'ordre d'origine (par date) est conservé. Sans date : en premier en croissant. */
function sortTransactions(list: Transaction[], key: SortKey, dir: SortDir): Transaction[] {
  const sign = dir === 'asc' ? 1 : -1;
  const compare =
    key === 'date'
      ? (a: Transaction, b: Transaction) => (a.tx_date ?? '').localeCompare(b.tx_date ?? '')
      : (a: Transaction, b: Transaction) =>
          a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => sign * compare(a, b));
}

@Component({
  selector: 'app-mois',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SortBarComponent],
  templateUrl: './mois.component.html',
  styleUrl: './mois.component.scss',
})
export class MoisComponent {
  formatEUR = formatEUR;
  formatPercent = formatPercent;

  form = signal<NewTxForm>(emptyForm('variable'));
  saving = signal(false);
  error = signal<string | null>(null);
  txError = signal<string | null>(null);
  generating = signal(false);
  info = signal<string | null>(null);

  addingFixed = signal(false);
  fixedInfo = signal<string | null>(null);
  fixedError = signal<string | null>(null);

  // Tri de la liste des transactions (affichage seulement, rien n'est enregistré)
  sortOptions: { key: SortKey; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'name', label: 'Nom' },
  ];
  sortKey = signal<SortKey>('date');
  sortDir = signal<SortDir>('asc');
  sortHint = computed(() => {
    const asc = this.sortDir() === 'asc';
    return this.sortKey() === 'date'
      ? asc ? 'du plus ancien au plus récent' : 'du plus récent au plus ancien'
      : asc ? 'de A à Z' : 'de Z à A';
  });
  sortedTransactions = computed<Transaction[]>(() =>
    sortTransactions(this.data.currentMonthTransactions(), this.sortKey(), this.sortDir())
  );

  editingBalance = signal(false);
  startInput = signal<number | null>(null);
  realBalanceInput = signal<number | null>(null);
  balanceError = signal<string | null>(null);

  private dialog = inject(DialogService);

  constructor(public data: DataService) {}

  async toggleStatus() {
    const cm = this.data.currentMonth();
    if (!cm) return;
    await this.data.setMonthStatus(cm.id, cm.status === 'current' ? 'closed' : 'current');
  }

  async createNextMonth() {
    this.generating.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      const { created } = await this.data.generateNextMonth();
      this.fixedInfo.set(null);
      this.fixedError.set(null);
      this.info.set(
        created
          ? 'Nouveau mois créé, vide. Le bouton « Ajouter les dépenses fixes » copie vos charges récurrentes.'
          : 'Ce mois existait déjà, affichage basculé dessus.'
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors de la création du mois.');
    } finally {
      this.generating.set(false);
    }
  }

  async addFixedExpenses() {
    const cm = this.data.currentMonth();
    if (!cm) return;
    this.addingFixed.set(true);
    this.fixedInfo.set(null);
    this.fixedError.set(null);
    try {
      const { added, alreadyThere, active } = await this.data.addFixedExpensesToMonth(cm.id);
      if (active === 0) {
        this.fixedInfo.set('Aucune dépense fixe active dans le référentiel.');
      } else if (added === 0) {
        this.fixedInfo.set('Toutes les dépenses fixes actives sont déjà dans ce mois.');
      } else {
        const skipped = alreadyThere > 0 ? `, ${alreadyThere} déjà présente(s) non recopiée(s)` : '';
        this.fixedInfo.set(`${added} dépense(s) fixe(s) ajoutée(s)${skipped}.`);
      }
    } catch (e: any) {
      this.fixedError.set(e?.message ?? "Erreur lors de l'ajout des dépenses fixes.");
    } finally {
      this.addingFixed.set(false);
    }
  }

  /** Clic sur un critère : le sélectionne (croissant) ou, s'il l'est déjà, inverse le sens. */
  toggleSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  startEditBalance() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    this.startInput.set(info?.value ?? null);
    this.realBalanceInput.set(cm?.real_balance_check ?? null);
    this.balanceError.set(null);
    this.editingBalance.set(true);
  }

  async saveBalance() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    if (!cm || !info) return;
    this.balanceError.set(null);
    try {
      // Seul le premier mois se saisit ici : les autres reportent le mois précédent (ou se recalent via le bouton dédié).
      if (info.isFirst && this.startInput() !== null && this.startInput() !== info.value) {
        await this.data.setMonthStart(cm.id, this.startInput());
      }
      await this.data.setRealBalanceCheck(cm.id, this.realBalanceInput());
      this.editingBalance.set(false);
    } catch (e: any) {
      this.balanceError.set(e?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  /** Écart non nul (au centime près) entre le solde réel constaté et le solde théorique. */
  hasGap(gap: number | null): gap is number {
    return gap !== null && Math.abs(gap) >= 0.005;
  }

  gapHelp(gap: number): string {
    const amount = formatEUR(Math.abs(gap));
    return gap < 0
      ? `Ton compte a ${amount} de moins que prévu : une dépense est peut être oubliée. Ajoute la, ou recale le solde de début.`
      : `Ton compte a ${amount} de plus que prévu : un revenu est peut être oublié, ou une dépense est trop élevée. Corrige la, ou recale le solde de début.`;
  }

  /** Calcule le solde de début qui ramène l'écart à zéro, puis demande confirmation avant de l'appliquer. */
  async recalibrate() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    const r = this.data.reconciliation();
    if (!cm || !info || !r || !this.hasGap(r.gap)) return;
    const newStart = Math.round((info.value + r.gap) * 100) / 100;
    const change = `Le solde de début passera de ${formatEUR(info.value)} à ${formatEUR(newStart)}, pour que le solde théorique corresponde à ton solde réel.`;
    const consequence = info.isFirst
      ? 'Les mois suivants partiront de ce nouveau solde.'
      : `${this.data.monthLabel(cm.month_date)} ne reprendra plus automatiquement le solde de fin de ${info.prevLabel}, et les mois suivants partiront de ce nouveau solde.`;
    const ok = await this.dialog.confirm({
      title: 'Recaler le solde de début ?',
      message: `${change}\n${consequence}`,
      confirmLabel: 'Recaler',
    });
    if (!ok) return;
    this.balanceError.set(null);
    try {
      await this.data.setMonthStart(cm.id, newStart);
    } catch (e: any) {
      this.balanceError.set(e?.message ?? 'Erreur lors du recalage.');
    }
  }

  async revertToAuto() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    if (!cm || !info || !info.forced || info.auto === null) return;
    const ok = await this.dialog.confirm({
      title: 'Revenir au report automatique ?',
      message: `Le solde de début de ${this.data.monthLabel(cm.month_date)} redeviendra ${formatEUR(info.auto)}, le solde de fin de ${info.prevLabel}.\nLe solde théorique de ce mois et des mois suivants sera recalculé.`,
      confirmLabel: 'Revenir au report',
    });
    if (!ok) return;
    this.balanceError.set(null);
    try {
      await this.data.setMonthStart(cm.id, null);
    } catch (e: any) {
      this.balanceError.set(e?.message ?? 'Erreur lors du changement.');
    }
  }

  async addTransaction() {
    const cm = this.data.currentMonth();
    const f = this.form();
    if (!cm) return;
    if (!f.name.trim() || f.amount === null || f.amount === undefined) {
      this.txError.set('Merci de renseigner au moins le nom et le montant.');
      return;
    }
    this.saving.set(true);
    this.txError.set(null);
    try {
      await this.data.addTransaction({
        month_id: cm.id,
        type: f.type,
        name: f.name.trim(),
        amount: Math.abs(f.amount),
        category_id: f.category_id,
        tx_date: f.tx_date,
        detail: f.detail?.trim() || null,
        necessary: f.necessary,
        received: f.received,
      });
      this.form.set(emptyForm(f.type));
    } catch (e: any) {
      this.txError.set(e?.message ?? "Erreur lors de l'ajout.");
    } finally {
      this.saving.set(false);
    }
  }

  updateFormField<K extends keyof NewTxForm>(key: K, value: NewTxForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async updateTxAmount(id: string, value: string) {
    const n = parseFloat(value.replace(',', '.'));
    if (!isNaN(n)) await this.data.updateTransaction(id, { amount: Math.abs(n) });
  }

  async updateTxDate(id: string, value: string) {
    await this.data.updateTransaction(id, { tx_date: value || null });
  }

  async updateTxCategory(id: string, value: string) {
    await this.data.updateTransaction(id, { category_id: value || null });
  }

  async updateTxName(id: string, value: string) {
    if (value.trim()) await this.data.updateTransaction(id, { name: value.trim() });
  }

  async toggleNecessary(id: string, current: boolean | null) {
    await this.data.updateTransaction(id, { necessary: !current });
  }

  async toggleReceived(id: string, current: boolean | null) {
    await this.data.updateTransaction(id, { received: !current });
  }

  async removeTx(id: string) {
    await this.data.deleteTransaction(id);
  }

  /**
   * Données de l'anneau "Répartition par catégorie" et de sa légende (voir core/services/breakdown.ts) :
   * 6 catégories en couleur, le reste regroupé en gris.
   */
  donutView(byCategory: BreakdownInput[]) {
    const R = 46;
    const C = 2 * Math.PI * R;
    const GAP = 2.5;

    const { slices, legend } = buildBreakdown(byCategory);
    const total = slices.reduce((sum, s) => sum + s.amount, 0);

    let cursor = 0;
    const segments = slices.map((s) => {
      const length = (s.amount / total) * C;
      const visible = slices.length > 1 ? Math.max(length - GAP, 0.5) : length;
      const seg = {
        id: s.id,
        name: s.name,
        amount: s.amount,
        color: s.color,
        dash: `${visible} ${C - visible}`,
        offset: -cursor,
        detail: s.grouped ? s.grouped.map((g) => g.categoryName).join(', ') : '',
      };
      cursor += length;
      return seg;
    });

    return { segments, legend };
  }

  categoryName(id: string | null): string {
    if (!id) return '—';
    return this.data.categories().find((c) => c.id === id)?.name ?? 'Catégorie supprimée';
  }

  typeLabel(t: TxType): string {
    return t === 'fixed' ? 'Fixe' : t === 'variable' ? 'Variable' : 'Revenu';
  }
}
