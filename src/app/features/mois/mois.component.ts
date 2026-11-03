import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { Transaction, TxType } from '../../core/models/models';
import { formatEUR, formatPercent } from '../../core/services/format';
import { addMonths, gapClues, isLateIncome, isTransfer, pendingOperations, toMonthDateString } from '../../core/services/calc';
import { IconComponent } from '../../shared/icon/icon.component';
import { compareIsoDatesNullLast, formatDateFr } from '../../core/services/date-fr';
import { DateFieldComponent } from '../../shared/date-field/date-field.component';
import { SearchBoxComponent } from '../../shared/search-box/search-box.component';
import { matchesSearch } from '../../core/services/search';
import { SortBarComponent, SortDir } from '../../shared/sort-bar/sort-bar.component';
import { BreakdownInput, buildBreakdown } from '../../core/services/breakdown';
import { BudgetSuggestionsComponent } from '../../shared/budget-suggestions/budget-suggestions.component';
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

/** Tri stable : à critère égal, l'ordre d'origine (par date) est conservé. Sans date : toujours à la fin, dans les deux sens. */
function sortTransactions(list: Transaction[], key: SortKey, dir: SortDir): Transaction[] {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'date') {
    return [...list].sort((a, b) => {
      if (!a.tx_date || !b.tx_date) return compareIsoDatesNullLast(a.tx_date, b.tx_date); // sans date : fin de liste quel que soit le sens
      return sign * a.tx_date.localeCompare(b.tx_date);
    });
  }
  return [...list].sort((a, b) => sign * a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Component({
  selector: 'app-mois',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SortBarComponent, SearchBoxComponent, DateFieldComponent, BudgetSuggestionsComponent],
  templateUrl: './mois.component.html',
  styleUrl: './mois.component.scss',
})
export class MoisComponent {
  formatEUR = formatEUR;
  formatPercent = formatPercent;

  form = signal<NewTxForm>(emptyForm('variable'));
  /** Le formulaire d'ajout saisit un virement vers un autre compte plutôt qu'une transaction ordinaire. */
  transferMode = signal(false);
  transferTo = signal<string | null>(null);
  isTransfer = isTransfer;
  /** Comptes vers lesquels on peut virer : les autres comptes actifs. */
  otherAccounts = computed(() =>
    this.data.accounts().filter((a) => a.status === 'active' && a.id !== this.data.currentAccountId())
  );
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
      ? (asc ? 'du plus ancien au plus récent' : 'du plus récent au plus ancien') + ', sans date à la fin'
      : asc ? 'de A à Z' : 'de Z à A';
  });
  sortedTransactions = computed<Transaction[]>(() =>
    sortTransactions(this.data.currentMonthTransactions(), this.sortKey(), this.sortDir())
  );

  isLate = isLateIncome;
  /** Revenus datés dans le passé mais pas cochés "Reçu" (à vérifier). */
  lateIncomes = computed(() => this.data.currentMonthTransactions().filter((t) => isLateIncome(t)));
  lateIncomesTotal = computed(() => this.lateIncomes().reduce((acc, t) => acc + t.amount, 0));

  // Recherche par nom dans les transactions du mois (affichage seulement)
  query = signal('');
  /** Filtre « dépenses sans date », activé depuis le panneau de rapprochement. */
  undatedOnly = signal(false);
  visibleTransactions = computed<Transaction[]>(() =>
    this.sortedTransactions().filter(
      (t) => matchesSearch(t.name, this.query()) && (!this.undatedOnly() || (t.type !== 'income' && !t.tx_date))
    )
  );
  searchInfo = computed(
    () => `${this.visibleTransactions().length} sur ${this.data.currentMonthTransactions().length}`
  );

  editingBalance = signal(false);
  startInput = signal<number | null>(null);
  realBalanceInput = signal<number | null>(null);
  balanceError = signal<string | null>(null);

  private dialog = inject(DialogService);

  // ---------- Budgets du mois ----------
  addingBudgets = signal(false);
  budgetInfo = signal<string | null>(null);
  budgetError = signal<string | null>(null);

  /** Rien à faire = bouton grisé, avec l'explication au survol (voir aussi fixedBtn pour les dépenses fixes). */
  applyBudgetsBtn(): { done: boolean; tip: string } {
    const cm = this.data.currentMonth();
    if (!cm) return { done: true, tip: '' };
    const missing = this.data.missingDefaultBudgets(cm.id);
    if (missing > 0) {
      return { done: false, tip: `Ajoute ${missing} budget${missing > 1 ? 's' : ''} par défaut à ce mois (les montants sont copiés, tu pourras les modifier).` };
    }
    const anyDefault = this.data.categories().some(
      (c) => !c.archived && c.budget_default !== null && c.budget_default !== undefined
    );
    return {
      done: true,
      tip: anyDefault
        ? 'Les budgets par défaut sont déjà appliqués à ce mois : cette action ne se fait qu\'une fois. Si tu définis le budget d\'une autre catégorie, le bouton se réactive.'
        : 'Aucun budget par défaut défini. Fixe un montant par catégorie dans l\'onglet Catégories, puis reviens ici.',
    };
  }

  async applyBudgets() {
    const cm = this.data.currentMonth();
    if (!cm || this.applyBudgetsBtn().done) return;
    this.addingBudgets.set(true);
    this.budgetInfo.set(null);
    this.budgetError.set(null);
    try {
      const n = await this.data.applyDefaultBudgets(cm.id);
      this.budgetInfo.set(`${n} budget${n > 1 ? 's' : ''} appliqué${n > 1 ? 's' : ''} à ce mois.`);
    } catch (e: any) {
      this.budgetError.set(e?.message ?? "Erreur lors de l'application des budgets.");
    } finally {
      this.addingBudgets.set(false);
    }
  }

  private async budgetAction(action: () => Promise<void>) {
    this.budgetInfo.set(null);
    this.budgetError.set(null);
    try {
      await action();
    } catch (e: any) {
      this.budgetError.set(e?.message ?? "Erreur lors de l'enregistrement du budget.");
    }
  }

  /** Montant modifié à la main pour ce mois seulement (champ vide ou négatif : on garde l'ancien montant). */
  async saveMonthBudget(row: { budget: { month_id: string; category_id: string; amount: number; include_fixed: boolean } }, raw: string) {
    const n = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0) return;
    const amount = Math.round(n * 100) / 100;
    if (amount === row.budget.amount) return;
    await this.budgetAction(() => this.data.setMonthBudget(row.budget.month_id, row.budget.category_id, amount, row.budget.include_fixed));
  }

  async toggleBudgetFixed(row: { budget: { month_id: string; category_id: string; amount: number } }, excludeFixed: boolean) {
    await this.budgetAction(() => this.data.setMonthBudget(row.budget.month_id, row.budget.category_id, row.budget.amount, !excludeFixed));
  }

  async removeBudget(row: { budget: { month_id: string; category_id: string } }) {
    await this.budgetAction(() => this.data.setMonthBudget(row.budget.month_id, row.budget.category_id, null, true));
  }

  async addBudget(select: HTMLSelectElement) {
    const cm = this.data.currentMonth();
    const id = select.value;
    select.value = '';
    if (!cm || !id) return;
    const cat = this.data.categories().find((c) => c.id === id);
    await this.budgetAction(() =>
      this.data.setMonthBudget(cm.id, id, cat?.budget_default ?? 0, cat?.budget_include_fixed !== false)
    );
  }

  /** Part du budget consommée en pourcentage, au delà de 100 % si dépassé. */
  percent(ratio: number): number {
    return Math.round(ratio * 100);
  }

  /** Part du budget consommée, bornée à 100 % pour la barre. */
  barWidth(ratio: number): number {
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
  }

  constructor(public data: DataService) {
    // Changer de mois efface la recherche : on ne veut pas croire qu'un mois est vide parce qu'un filtre reste actif.
    effect(() => {
      this.data.currentMonth()?.id;
      untracked(() => {
        this.query.set('');
        this.undatedOnly.set(false);
      });
    });
    // Plus aucune dépense sans date (elles viennent d'être datées) : le filtre n'a plus lieu d'être.
    effect(() => {
      if (gapClues(this.data.currentMonthTransactions()).undatedExpenses.length === 0) {
        untracked(() => this.undatedOnly.set(false));
      }
    });
  }

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
      const cm = this.data.currentMonth();
      const nextDate = cm ? toMonthDateString(addMonths(new Date(cm.month_date + 'T00:00:00'), 1)) : null;
      const nextExists = !!nextDate && this.data.months().some((m) => m.month_date === nextDate);

      // Opérations pas encore réalisées : elles pèsent dans le solde de fin du mois, donc dans le solde de départ du suivant.
      let decision: { choice: string | null; amount: number | null } | null = null;
      let pendingIds: string[] = [];
      if (cm && nextDate && !nextExists) {
        const pending = pendingOperations(this.data.currentMonthTransactions());
        if (pending.items.length > 0) {
          const asked = await this.askPendingDecision(cm.month_date, nextDate, pending);
          if (!asked) return; // annulé : rien n'est créé, on peut corriger les lignes à la main
          decision = asked;
          pendingIds = pending.items.map((t) => t.id);
        }
      }

      const { month, created } = await this.data.generateNextMonth();
      if (created && decision) {
        if (decision.choice === 'move') await this.data.moveTransactions(pendingIds, month.id);
        else if (decision.choice === 'delete') await this.data.deleteTransactions(pendingIds);
        if (decision.amount !== null) {
          const carried = this.data.currentSummary()?.startingBalance ?? 0;
          if (Math.abs(decision.amount - carried) >= 0.005) {
            await this.data.setMonthStart(month.id, decision.amount);
          }
        }
      }
      // Les budgets par défaut des catégories sont copiés dans le nouveau mois (valeurs figées, modifiables ensuite).
      let budgetNote = '';
      if (created && this.data.budgetsAvailable()) {
        try {
          const n = await this.data.applyDefaultBudgets(month.id);
          if (n > 0) budgetNote = ` ${n} budget${n > 1 ? 's' : ''} par défaut appliqué${n > 1 ? 's' : ''}.`;
        } catch (e: any) {
          budgetNote = ` Budgets non appliqués : ${e?.message ?? 'erreur'}. Le bouton du panneau Budgets permet de réessayer.`;
        }
      }
      this.fixedInfo.set(null);
      this.fixedError.set(null);
      this.info.set(
        created
          ? `Nouveau mois créé, vide. Le bouton « Ajouter les dépenses fixes » copie vos charges récurrentes.${budgetNote}`
          : 'Ce mois existait déjà, affichage basculé dessus.'
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors de la création du mois.');
    } finally {
      this.generating.set(false);
    }
  }

  private askPendingDecision(
    prevDate: string,
    nextDate: string,
    pending: ReturnType<typeof pendingOperations>
  ) {
    const prevLabel = this.data.monthLabel(prevDate);
    const nextLabel = this.data.monthLabel(nextDate);
    const n = pending.items.length;
    const summary = this.data.currentSummary();
    const endBalance = summary?.endingBalance ?? 0;
    const ended = new Date() >= new Date(nextDate + 'T00:00:00');

    const lines = pending.items.slice(0, 8).map((t) => {
      const income = t.type === 'income';
      const when = income
        ? t.tx_date
          ? `revenu non reçu, prévu le ${formatDateFr(t.tx_date)}`
          : 'revenu non reçu'
        : t.tx_date
          ? `prévu le ${formatDateFr(t.tx_date)}`
          : 'sans date';
      return `${t.name} : ${income ? '+' : '−'}${formatEUR(t.amount)} (${when})`;
    });
    if (n > lines.length) lines.push(`et ${n - lines.length} autre${n - lines.length > 1 ? 's' : ''}…`);

    const startWith = (choice: string | null) =>
      round2(choice === 'keep' ? endBalance : endBalance - pending.net);

    return this.dialog.promptChoice({
      title: `${n} opération${n > 1 ? 's' : ''} de ${prevLabel} ${n > 1 ? 'ne sont' : 'n\'est'} pas encore réalisée${n > 1 ? 's' : ''}`,
      message:
        `Elles comptent dans le solde de fin de ${prevLabel} (${formatEUR(endBalance)}), qui devient le solde de départ de ${nextLabel}. Ce solde peut donc différer de celui de ta banque.` +
        (ended ? '' : `\n${prevLabel} n'est pas terminé : ces opérations sont peut être simplement à venir.`),
      items: lines,
      choices: [
        {
          value: 'move',
          label: `Les reporter dans ${nextLabel}`,
          hint: 'Elles quittent le mois précédent et reviennent dans le suivant, au même jour du mois (05/11 devient 05/12). Un virement suit aussi sur l\'autre compte.',
        },
        {
          value: 'delete',
          label: `Les supprimer de ${prevLabel}`,
          hint: 'Elles n\'ont pas eu lieu : elles disparaissent du suivi.',
        },
        {
          value: 'keep',
          label: `Les garder dans ${prevLabel}`,
          hint: 'Elles restent comptées dans le solde de départ du nouveau mois.',
        },
      ],
      defaultChoice: 'move',
      amountLabel: ended ? 'Solde réel de ton compte aujourd\'hui (facultatif)' : undefined,
      amountHint: ended
        ? `Si tu le renseignes, il devient le solde de départ de ${nextLabel}, à la place du report calculé.`
        : undefined,
      preview: (choice, amount) => {
        const start = startWith(choice);
        const out = [`Solde de départ de ${nextLabel} : ${formatEUR(start)}.`];
        if (amount !== null && Math.abs(amount - start) >= 0.005) {
          out.push(`Avec ton solde réel, il sera de ${formatEUR(amount)} (écart de ${formatEUR(round2(amount - start))}).`);
        }
        return out.join('\n');
      },
      confirmLabel: `Créer ${nextLabel}`,
      cancelLabel: 'Annuler',
    });
  }

  /**
   * État du bouton « Ajouter les dépenses fixes » : grisé quand il n'y a plus rien à ajouter ni à mettre à jour.
   * Calculé depuis les données (pas d'un « déjà cliqué » mémorisé) : il se réactive si une dépense fixe est ajoutée au référentiel.
   */
  fixedBtn(): { done: boolean; tip: string } {
    const cm = this.data.currentMonth();
    if (!cm) return { done: true, tip: '' };
    const plan = this.data.planFixedExpenses(cm.id);
    if (plan.active.length === 0) {
      return { done: true, tip: 'Aucune dépense fixe active dans le référentiel. Ajoutes-en dans l\'onglet Dépenses fixes.' };
    }
    const dates = this.data.fixedDateChanges(cm.id).length;
    if (plan.toAdd.length === 0 && dates === 0) {
      return {
        done: true,
        tip: 'Toutes les dépenses fixes actives sont déjà dans ce mois : cette action ne se fait qu\'une fois. Si tu ajoutes une dépense fixe au référentiel, le bouton se réactive.',
      };
    }
    const parts = [];
    if (plan.toAdd.length > 0) parts.push(`${plan.toAdd.length} dépense${plan.toAdd.length > 1 ? 's' : ''} fixe${plan.toAdd.length > 1 ? 's' : ''} à ajouter`);
    if (dates > 0) parts.push(`${dates} date${dates > 1 ? 's' : ''} à mettre à jour`);
    return { done: false, tip: parts.join(', ') + '.' };
  }

  async addFixedExpenses() {
    const cm = this.data.currentMonth();
    if (!cm || this.fixedBtn().done) return;
    this.addingFixed.set(true);
    this.fixedInfo.set(null);
    this.fixedError.set(null);
    try {
      const { added, alreadyThere, active, failed } = await this.data.addFixedExpensesToMonth(cm.id);
      if (failed.length > 0) {
        this.fixedError.set(`${failed.length} virement(s) fixe(s) non créé(s) : ${failed.join(' ; ')}`);
      }
      // Lignes déjà dans le mois dont le jour de prélèvement a changé depuis : on propose de remettre leur date à jour.
      const changes = this.data.fixedDateChanges(cm.id);
      let dated = 0;
      if (changes.length > 0) {
        const shown = changes.slice(0, 8).map((c) => `${c.name} : ${formatDateFr(c.from) || 'sans date'} → ${formatDateFr(c.to) || 'sans date'}`);
        if (changes.length > shown.length) shown.push(`et ${changes.length - shown.length} autre(s).`);
        const ok = await this.dialog.confirm({
          title: `Mettre à jour la date de ${changes.length} dépense${changes.length > 1 ? 's' : ''} fixe${changes.length > 1 ? 's' : ''} ?`,
          message: `Ces dépenses sont déjà dans ${this.data.monthLabel(cm.month_date)}, mais leur date ne correspond plus au jour de prélèvement du référentiel.\n${shown.join('\n')}\nSeule la date change : le montant, la catégorie et le reste ne bougent pas.`,
          confirmLabel: 'Mettre à jour les dates',
          cancelLabel: 'Laisser tel quel',
        });
        if (ok) {
          await this.data.applyFixedDateChanges(changes);
          dated = changes.length;
        }
      }
      const datedNote = dated > 0 ? `${dated} date(s) mise(s) à jour.` : '';
      if (active === 0) {
        this.fixedInfo.set('Aucune dépense fixe active dans le référentiel.');
      } else if (added === 0) {
        if (failed.length === 0) this.fixedInfo.set(['Toutes les dépenses fixes actives sont déjà dans ce mois.', datedNote].filter(Boolean).join(' '));
      } else {
        const skipped = alreadyThere > 0 ? `, ${alreadyThere} déjà présente(s) non recopiée(s)` : '';
        this.fixedInfo.set([`${added} dépense(s) fixe(s) ajoutée(s)${skipped}.`, datedNote].filter(Boolean).join(' '));
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

  /** Résumé court sous le solde théorique : les dépenses sans date ne sont pas comptées aujourd'hui (null s'il n'y en a pas). */
  undatedLabel(): string | null {
    const c = gapClues(this.data.currentMonthTransactions());
    const u = c.undatedExpenses.length;
    if (u === 0) return null;
    return `${u} dépense${u > 1 ? 's' : ''} sans date (${formatEUR(c.undatedTotal)}) non comptée${u > 1 ? 's' : ''}`;
  }

  /** Filtre la liste sur les dépenses sans date et y amène l'écran (utile sur mobile, où la liste est plus bas). */
  filterUndated() {
    this.query.set('');
    this.undatedOnly.set(true);
    setTimeout(() => document.getElementById('tx-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /** Écart non nul (au centime près) entre le solde réel constaté et le solde théorique. */
  hasGap(gap: number | null): gap is number {
    return gap !== null && Math.abs(gap) >= 0.005;
  }

  /**
   * Message d'aide sous l'écart. Il dépend du signe de l'écart et des transactions du mois :
   * revenus pas cochés "Reçu", dépenses datées plus tard, correspondance exacte avec un revenu.
   */
  gapHelp(gap: number): string {
    const amount = formatEUR(Math.abs(gap));
    const c = gapClues(this.data.currentMonthTransactions());
    const parts: string[] = [];
    if (gap > 0) {
      parts.push(`Ton compte a ${amount} de plus que prévu.`);
      const n = c.unreceivedIncomes.length;
      if (n > 0) {
        parts.push(
          n === 1
            ? `1 revenu (${formatEUR(c.unreceivedTotal)}) n'est pas coché « Reçu » : coche le s'il est arrivé, l'écart se recalcule tout seul.`
            : `${n} revenus (${formatEUR(c.unreceivedTotal)} au total) ne sont pas cochés « Reçu » : coche ceux qui sont arrivés, l'écart se recalcule tout seul.`
        );
        const exact = c.unreceivedIncomes.find((t) => Math.abs(t.amount - gap) < 0.005);
        if (exact) parts.push(`Le revenu « ${exact.name} » correspond exactement à cet écart.`);
        else if (c.unreceivedTotal > gap) {
          parts.push(`Si tu les cochais tous, l'écart deviendrait ${formatEUR(gap - c.unreceivedTotal)}.`);
        }
      } else {
        parts.push('Un revenu est peut être oublié, ou une dépense est saisie trop haute.');
      }
    } else {
      parts.push(`Ton compte a ${amount} de moins que prévu.`);
      const u = c.undatedExpenses.length;
      if (u > 0) {
        parts.push(
          `${u} dépense${u > 1 ? 's' : ''} sans date (${formatEUR(c.undatedTotal)} au total) ne ${u > 1 ? 'sont' : 'est'} pas comptée${u > 1 ? 's' : ''} aujourd'hui : si ${u > 1 ? 'certaines' : 'elle'} ${u > 1 ? 'sont' : 'est'} déjà prélevée${u > 1 ? 's' : ''}, donne-${u > 1 ? 'leur' : 'lui'} sa date.`
        );
      }
      const n = c.laterExpenses.length;
      if (n > 0) {
        parts.push(
          `${n} dépense${n > 1 ? 's' : ''} datée${n > 1 ? 's' : ''} plus tard (${formatEUR(c.laterTotal)} au total) ne ${n > 1 ? 'sont' : 'est'} pas encore comptée${n > 1 ? 's' : ''} : si ${n > 1 ? 'l\'une' : 'elle'} a déjà été prélevée, corrige sa date.`
        );
      }
      parts.push("Sinon, une dépense est peut être oubliée ou saisie trop basse, ou un revenu coché « Reçu » n'est pas encore arrivé.");
    }
    parts.push("Si l'écart est normal, tu peux recaler.");
    return parts.join(' ');
  }

  /**
   * Recalage : l'utilisateur confirme le solde que son compte affiche maintenant (la seule valeur certaine),
   * puis le solde de début du mois, donc le solde de fin du mois précédent, est ajusté pour que le suivi retombe dessus.
   * Si des mouvements sont déjà comptés ce mois ci, ils sont retirés : fin du mois précédent = réel − mouvements du mois.
   */
  async recalibrate() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    const r = this.data.reconciliation();
    if (!cm || !info || !r || !this.hasGap(r.gap)) return;
    const movements = round2(r.theoretical - info.value);
    const startFor = (real: number) => round2(real - movements);
    const monthLabel = this.data.monthLabel(cm.month_date);
    const target = info.isFirst ? 'le solde de départ du suivi' : `le solde de fin de ${info.prevLabel}`;

    const preview = (real: number) => {
      const next = startFor(real);
      const lines = [
        `Solde théorique d'aujourd'hui : ${formatEUR(r.theoretical)}, écart avec ton solde réel : ${formatEUR(round2(real - r.theoretical))}.`,
        info.isFirst
          ? `Le solde de départ du suivi passera de ${formatEUR(info.value)} à ${formatEUR(next)}.`
          : `Le solde de fin de ${info.prevLabel} passera de ${formatEUR(info.value)} à ${formatEUR(next)}.`,
      ];
      lines.push(
        Math.abs(movements) < 0.005
          ? `Aucun mouvement n'est encore compté en ${monthLabel} : ce solde est exactement ton solde réel.`
          : `${monthLabel} compte déjà ${formatEUR(movements)} de mouvements depuis le début du mois, d'où la différence avec ton solde réel.`
      );
      if (!info.isFirst) {
        lines.push(`${info.prevLabel} sera marqué « Solde forcé de fin de mois », et ${monthLabel} comme les mois suivants partiront de ce solde.`);
      }
      return lines.join('\n');
    };

    const real = await this.dialog.promptAmount({
      title: info.isFirst ? 'Recaler le solde de départ du suivi ?' : `Recaler le solde de fin de ${info.prevLabel} ?`,
      message: `Indique le solde que ton compte affiche en ce moment. C'est la seule valeur certaine : ${target} est ajusté à partir d'elle, pas du solde théorique.`,
      amountLabel: 'Solde réel de ton compte aujourd\'hui (€)',
      amount: r.real,
      preview,
      confirmLabel: 'Recaler',
    });
    if (real === null) return;

    this.balanceError.set(null);
    try {
      if (real !== r.real) await this.data.setRealBalanceCheck(cm.id, real);
      const next = startFor(real);
      // Si le nouveau solde retombe sur le calcul automatique, on supprime le forçage plutôt que d'en garder un sans écart.
      const auto = !info.isFirst && info.prevComputedEnd !== null && Math.abs(next - info.prevComputedEnd) < 0.005;
      await this.data.setMonthStart(cm.id, auto ? null : next);
    } catch (e: any) {
      this.balanceError.set(e?.message ?? 'Erreur lors du recalage.');
    }
  }

  async revertToAuto() {
    const cm = this.data.currentMonth();
    const info = this.data.startInfo();
    if (!cm || !info || !info.prevForced || info.prevComputedEnd === null) return;
    const ok = await this.dialog.confirm({
      title: `Revenir au calcul automatique de ${info.prevLabel} ?`,
      message: `Le solde de fin de ${info.prevLabel} redeviendra ${formatEUR(info.prevComputedEnd)}, calculé avec ses transactions, et ${this.data.monthLabel(cm.month_date)} partira de ce solde.\nLes soldes des mois suivants seront recalculés.`,
      confirmLabel: 'Revenir au calcul',
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
    if (this.transferMode()) {
      await this.addTransfer(cm.id, f);
      return;
    }
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

  /** Liste « Type » du formulaire : les trois types de transaction, plus le virement vers un autre compte. */
  onFormTypeChange(value: string) {
    this.txError.set(null);
    if (value === 'transfer') {
      this.transferMode.set(true);
      this.transferTo.set(this.otherAccounts()[0]?.id ?? null);
      return;
    }
    this.transferMode.set(false);
    this.updateFormField('type', value as TxType);
  }

  private async addTransfer(monthId: string, f: NewTxForm) {
    const to = this.transferTo();
    if (!to || f.amount === null || f.amount === undefined || !f.tx_date) {
      this.txError.set('Un virement demande un compte de destination, un montant et une date.');
      return;
    }
    if (!(Math.abs(f.amount) > 0)) {
      this.txError.set('Le montant du virement doit être supérieur à zéro.');
      return;
    }
    this.saving.set(true);
    this.txError.set(null);
    try {
      await this.data.createTransfer({
        fromMonthId: monthId,
        toAccountId: to,
        amount: Math.abs(f.amount),
        date: f.tx_date,
        name: f.name,
        detail: f.detail,
      });
      // On reste en mode virement (on en enchaîne souvent plusieurs), le formulaire est vidé.
      this.form.set(emptyForm(f.type));
    } catch (e: any) {
      this.txError.set(e?.message ?? "Erreur lors du virement.");
    } finally {
      this.saving.set(false);
    }
  }

  /** Nom du compte "en face" d'un virement. */
  peerAccountName(t: Transaction): string {
    return this.data.accounts().find((a) => a.id === t.transfer_account_id)?.name ?? 'autre compte';
  }

  /** Un virement est fait dès que sa date est passée (même règle des deux côtés). */
  transferDone(t: Transaction): boolean {
    return !!t.tx_date && new Date(t.tx_date + 'T00:00:00') <= new Date();
  }

  updateFormField<K extends keyof NewTxForm>(key: K, value: NewTxForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async updateTxAmount(id: string, value: string) {
    const n = parseFloat(value.replace(',', '.'));
    if (!isNaN(n)) await this.data.updateTransaction(id, { amount: Math.abs(n) });
  }

  async updateTxDate(id: string, value: string) {
    const t = this.data.transactions().find((x) => x.id === id);
    if (t && isTransfer(t) && !value) {
      this.txError.set('Un virement doit avoir une date.');
      return;
    }
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
    const t = this.data.transactions().find((x) => x.id === id);
    const label = t ? `« ${t.name} » (${formatEUR(t.amount)})` : 'cette transaction';
    const transfer = t && isTransfer(t);
    const ok = await this.dialog.confirm({
      title: transfer ? 'Supprimer ce virement ?' : 'Supprimer cette transaction ?',
      message: transfer
        ? `${label} sera supprimé des deux comptes : ici et sur « ${this.peerAccountName(t)} ». Les soldes des deux comptes seront recalculés.`
        : `${label} sera supprimée définitivement. Les soldes du mois et des mois suivants seront recalculés.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await this.data.deleteTransaction(id);
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

  /** Libellé de la colonne Type d'une ligne : « Virement » pour les deux moitiés d'un virement. */
  rowTypeLabel(t: Transaction): string {
    return isTransfer(t) ? 'Virement' : this.typeLabel(t.type);
  }
}
