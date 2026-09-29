import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { TxType } from '../../core/models/models';
import { formatEUR, formatPercent } from '../../core/services/format';
import { IconComponent } from '../../shared/icon/icon.component';
import { categoryColor } from '../../core/theme/chart-colors';

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

@Component({
  selector: 'app-mois',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
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

  editingBalance = signal(false);
  balanceOverrideInput = signal<number | null>(null);
  realBalanceInput = signal<number | null>(null);

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
      const { count } = await this.data.generateNextMonth();
      this.info.set(
        count > 0
          ? `Nouveau mois créé, ${count} dépense(s) fixe(s) copiée(s) automatiquement.`
          : 'Ce mois existait déjà, affichage basculé dessus.'
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors de la création du mois.');
    } finally {
      this.generating.set(false);
    }
  }

  startEditBalance() {
    const cm = this.data.currentMonth();
    this.balanceOverrideInput.set(cm?.starting_balance_override ?? null);
    this.realBalanceInput.set(cm?.real_balance_check ?? null);
    this.editingBalance.set(true);
  }

  async saveBalanceOverride() {
    const cm = this.data.currentMonth();
    if (!cm) return;
    await this.data.setStartingBalanceOverride(cm.id, this.balanceOverrideInput());
    await this.data.setRealBalanceCheck(cm.id, this.realBalanceInput());
    this.editingBalance.set(false);
  }

  clearOverride() {
    this.balanceOverrideInput.set(null);
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
   * Données de l'anneau "Répartition par catégorie" et de sa légende.
   * L'anneau ne montre que les montants positifs ; la légende garde toutes les
   * lignes non nulles, comme l'ancienne liste. Les couleurs suivent l'ordre fixe
   * de la palette (au-delà de 6 catégories : gris).
   */
  donutView(byCategory: { categoryId: string | null; categoryName: string; amount: number }[]) {
    const R = 46;
    const C = 2 * Math.PI * R;
    const GAP = 2.5;

    const positives = byCategory.filter((b) => b.amount > 0);
    const total = positives.reduce((sum, b) => sum + b.amount, 0);
    // La couleur suit la position de la catégorie dans la liste complète (et non son rang
    // parmi les montants non nuls) : une catégorie garde sa couleur d'un mois à l'autre.
    const colorOf = new Map<string, string>();
    byCategory.forEach((b, i) => colorOf.set(String(b.categoryId), categoryColor(i)));

    let cursor = 0;
    const segments = positives.map((b) => {
      const length = (b.amount / total) * C;
      const visible = positives.length > 1 ? Math.max(length - GAP, 0.5) : length;
      const seg = {
        id: String(b.categoryId),
        name: b.categoryName,
        amount: b.amount,
        color: colorOf.get(String(b.categoryId))!,
        dash: `${visible} ${C - visible}`,
        offset: -cursor,
      };
      cursor += length;
      return seg;
    });

    const legend = byCategory
      .filter((b) => b.amount !== 0)
      .map((b) => ({
        id: String(b.categoryId),
        name: b.categoryName,
        amount: b.amount,
        color: colorOf.get(String(b.categoryId)) ?? '#8f8a7e',
      }));

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
