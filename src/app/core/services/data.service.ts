import { Injectable, computed, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  Category,
  FixedExpense,
  MonthBudget,
  MonthRow,
  MonthSummary,
  Transaction,
  UserSettings,
} from '../models/models';
import type { ImportPlan } from '../excel/excel-import';
import { fixedExpenseDetail, monthlyShare } from './fixed-expense';
import { compareIsoDatesNullLast, daysInMonth } from './date-fr';
import { BudgetSuggestion, suggestBudgets } from './stats';
import { addMonths, budgetSpent, budgetStatus, formatMonthLabel, summarizeMonth, theoreticalBalanceToday, toMonthDateString } from './calc';

const DEFAULT_CATEGORIES = [
  'Logement',
  'Énergie',
  'Abonnements',
  'Santé',
  'Transport',
  'Épargne',
  'Alimentation',
  'Loisirs',
  'Autres',
];

@Injectable({ providedIn: 'root' })
export class DataService {
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly categories = signal<Category[]>([]);
  readonly fixedExpenses = signal<FixedExpense[]>([]);
  readonly months = signal<MonthRow[]>([]);
  readonly transactions = signal<Transaction[]>([]);
  readonly settings = signal<UserSettings | null>(null);
  readonly monthBudgets = signal<MonthBudget[]>([]);
  /** Faux tant que le script supabase/budgets.sql n'a pas été exécuté : les budgets sont alors masqués et non enregistrables. */
  readonly budgetsAvailable = signal(true);

  /** Catégories utilisables pour une nouvelle opération (les archivées n'y figurent plus). */
  readonly activeCategories = computed(() => this.categories().filter((c) => !c.archived));

  /**
   * Catégories proposées dans une liste déroulante : les actives, plus la catégorie déjà choisie même si elle
   * est archivée (sinon l'opération paraîtrait "sans catégorie" à l'écran).
   */
  categoryOptions(currentId: string | null | undefined): Category[] {
    return this.categories().filter((c) => !c.archived || c.id === currentId);
  }

  /** Mois triés du plus ancien au plus récent. */
  readonly sortedMonths = computed(() =>
    [...this.months()].sort((a, b) => a.month_date.localeCompare(b.month_date))
  );

  /** Le mois "actuel" au sens app : le plus récent non explicitement marqué autrement.
   *  On affiche par défaut le mois dont le statut est 'current' ; s'il y en a plusieurs
   *  (ne devrait pas arriver) on prend le plus récent ; s'il n'y en a aucun, le plus récent tout court. */
  readonly currentMonth = signal<MonthRow | null>(null);

  /** Résumés de TOUS les mois, dans l'ordre, soldes reportés en chaîne. */
  readonly allSummaries = computed<MonthSummary[]>(() => {
    const months = this.sortedMonths();
    const cats = this.categories();
    const settings = this.settings();
    const summaries: MonthSummary[] = [];
    let carry = settings?.initial_balance ?? 0;
    months.forEach((m, i) => {
      const tx = this.transactions().filter((t) => t.month_id === m.id);
      const own = m.starting_balance_override;
      // Premier mois : son solde de début est le solde initial du suivi (une éventuelle ancienne valeur forcée prime).
      // Autres mois : ils reprennent la fin du mois précédent, qui peut elle même être forcée (voir ci dessous).
      const startingBalance = i === 0 && own !== null && own !== undefined ? own : carry;
      // Un recalage depuis le mois suivant force le solde de FIN de ce mois : la valeur est stockée sur le mois suivant
      // (starting_balance_override), et c'est ce mois ci qui l'affiche comme "solde forcé de fin de mois".
      const nextOverride = months[i + 1]?.starting_balance_override;
      const forcedEnd = nextOverride !== null && nextOverride !== undefined ? nextOverride : null;
      const s = summarizeMonth(m, tx, cats, startingBalance, forcedEnd);
      summaries.push(s);
      carry = s.endingBalance;
    });
    return summaries;
  });

  readonly currentSummary = computed<MonthSummary | null>(() => {
    const cm = this.currentMonth();
    if (!cm) return null;
    return this.allSummaries().find((s) => s.month.id === cm.id) ?? null;
  });

  readonly currentMonthTransactions = computed<Transaction[]>(() => {
    const cm = this.currentMonth();
    if (!cm) return [];
    return this.transactions()
      .filter((t) => t.month_id === cm.id)
      .sort((a, b) => compareIsoDatesNullLast(a.tx_date, b.tx_date));
  });

  readonly reconciliation = computed(() => {
    const cm = this.currentMonth();
    const s = this.currentSummary();
    if (!cm || !s) return null;
    const theoretical = theoreticalBalanceToday(
      s.startingBalance,
      this.currentMonthTransactions()
    );
    const real = cm.real_balance_check ?? null;
    const gap = real !== null ? real - theoretical : null;
    return { theoretical, real, gap };
  });

  /** Le premier mois du suivi : son solde de début est le "solde initial" (il n'a pas de mois précédent). */
  isFirstMonth(id: string): boolean {
    return this.sortedMonths()[0]?.id === id;
  }

  /**
   * D'où vient le solde de début du mois affiché : solde de départ du suivi (premier mois),
   * ou solde de fin du mois précédent, éventuellement forcé par un recalage.
   */
  readonly startInfo = computed(() => {
    const cm = this.currentMonth();
    if (!cm) return null;
    const list = this.allSummaries();
    const i = list.findIndex((s) => s.month.id === cm.id);
    if (i < 0) return null;
    const prev = i > 0 ? list[i - 1] : null;
    const value = list[i].startingBalance;
    return {
      isFirst: prev === null,
      value,
      prevForced: prev?.endingForced ?? false,
      /** Solde de fin du mois précédent tel que calculé par ses transactions (sans forçage). */
      prevComputedEnd: prev ? prev.computedEndingBalance : null,
      gap: prev?.endingForced ? Math.round((prev.endingBalance - prev.computedEndingBalance) * 100) / 100 : 0,
      prevLabel: prev ? this.monthLabel(prev.month.month_date) : null,
    };
  });

  /** Mois dont le solde de fin est forcé (recalage depuis le mois suivant) : la chaîne repart de la valeur forcée. */
  readonly forcedMonths = computed(() => {
    return this.allSummaries()
      .filter((s) => s.endingForced)
      .map((s) => ({
        month: s.month,
        forced: s.endingBalance,
        computed: s.computedEndingBalance,
        gap: Math.round((s.endingBalance - s.computedEndingBalance) * 100) / 100,
      }));
  });

  constructor(private supa: SupabaseService) {
    effect(() => {
      const uid = this.supa.userId;
      if (uid && this.supa.ready()) {
        this.loadAll();
      } else if (this.supa.ready() && !uid) {
        this.resetLocal();
      }
    });
  }

  private resetLocal() {
    this.categories.set([]);
    this.fixedExpenses.set([]);
    this.months.set([]);
    this.transactions.set([]);
    this.settings.set(null);
    this.monthBudgets.set([]);
    this.currentMonth.set(null);
    this.loading.set(false);
  }

  async loadAll() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const uid = this.supa.userId;
      if (!uid) return;

      const [catsRes, fixedRes, monthsRes, txRes, settingsRes, budgetsRes] = await Promise.all([
        this.supa.client.from('categories').select('*').order('sort_order'),
        this.supa.client.from('fixed_expenses').select('*').order('created_at'),
        this.supa.client.from('months').select('*').order('month_date'),
        this.supa.client.from('transactions').select('*'),
        this.supa.client.from('user_settings').select('*').maybeSingle(),
        this.supa.client.from('month_budgets').select('*'),
      ]);

      if (catsRes.error) throw catsRes.error;
      if (fixedRes.error) throw fixedRes.error;
      if (monthsRes.error) throw monthsRes.error;
      if (txRes.error) throw txRes.error;

      let cats = (catsRes.data ?? []) as Category[];
      if (cats.length === 0) {
        cats = await this.seedDefaultCategories(uid);
      }
      this.categories.set(cats);
      this.fixedExpenses.set((fixedRes.data ?? []) as FixedExpense[]);
      this.transactions.set((txRes.data ?? []) as Transaction[]);
      // Budgets : si la table n'existe pas encore (script SQL pas lancé), on continue sans eux au lieu de bloquer l'app.
      this.budgetsAvailable.set(!budgetsRes.error);
      this.monthBudgets.set(budgetsRes.error ? [] : ((budgetsRes.data ?? []) as MonthBudget[]));
      if (budgetsRes.error) console.warn('Budgets indisponibles :', budgetsRes.error.message);

      let settings = settingsRes.data as UserSettings | null;
      if (!settings) {
        const { data, error } = await this.supa.client
          .from('user_settings')
          .insert({ user_id: uid, initial_balance: 0 })
          .select()
          .single();
        if (error) throw error;
        settings = data as UserSettings;
      }
      this.settings.set(settings);

      let months = (monthsRes.data ?? []) as MonthRow[];
      if (months.length === 0) {
        const created = await this.createFirstMonth(uid);
        months = [created];
      }
      this.months.set(months);

      const current = months.find((m) => m.status === 'current') ?? months[months.length - 1];
      this.currentMonth.set(current);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur de chargement');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  private async seedDefaultCategories(uid: string): Promise<Category[]> {
    const rows = DEFAULT_CATEGORIES.map((name, i) => ({ user_id: uid, name, sort_order: i }));
    const { data, error } = await this.supa.client.from('categories').insert(rows).select();
    if (error) throw error;
    return (data ?? []) as Category[];
  }

  private async createFirstMonth(uid: string): Promise<MonthRow> {
    const now = new Date();
    const monthDate = toMonthDateString(now);
    const { data, error } = await this.supa.client
      .from('months')
      .insert({ user_id: uid, month_date: monthDate, status: 'current' })
      .select()
      .single();
    if (error) throw error;
    return data as MonthRow;
  }

  // ------------------------------------------------------------
  // Catégories
  // ------------------------------------------------------------
  async addCategory(name: string) {
    const uid = this.supa.userId!;
    const sortOrder = this.categories().length;
    const { data, error } = await this.supa.client
      .from('categories')
      .insert({ user_id: uid, name, sort_order: sortOrder })
      .select()
      .single();
    if (error) throw error;
    this.categories.update((list) => [...list, data as Category]);
  }

  async renameCategory(id: string, name: string) {
    const { error } = await this.supa.client.from('categories').update({ name }).eq('id', id);
    if (error) throw error;
    this.categories.update((list) => list.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  async deleteCategory(id: string) {
    const { error } = await this.supa.client.from('categories').delete().eq('id', id);
    if (error) throw error;
    this.categories.update((list) => list.filter((c) => c.id !== id));
    // La base met "sans catégorie" sur les opérations concernées et supprime les budgets de la catégorie : on fait pareil ici,
    // sinon l'écran garderait l'ancienne catégorie jusqu'au prochain rechargement.
    this.transactions.update((list) => list.map((t) => (t.category_id === id ? { ...t, category_id: null } : t)));
    this.fixedExpenses.update((list) => list.map((f) => (f.category_id === id ? { ...f, category_id: null } : f)));
    this.monthBudgets.update((list) => list.filter((b) => b.category_id !== id));
  }

  /** Archive ou restaure une catégorie. Archivée, elle disparaît des listes de saisie mais reste dans l'historique. */
  async setCategoryArchived(id: string, archived: boolean) {
    const { error } = await this.supa.client.from('categories').update({ archived }).eq('id', id);
    if (error) throw error;
    this.categories.update((list) => list.map((c) => (c.id === id ? { ...c, archived } : c)));
  }

  /** Budget mensuel par défaut d'une catégorie (null = aucun) et choix de compter ou non ses dépenses fixes. */
  async setCategoryBudget(id: string, amount: number | null, includeFixed: boolean) {
    const patch = { budget_default: amount, budget_include_fixed: includeFixed };
    const { error } = await this.supa.client.from('categories').update(patch).eq('id', id);
    if (error) throw error;
    this.categories.update((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // ------------------------------------------------------------
  // Budgets par mois
  // ------------------------------------------------------------

  /** La catégorie Épargne a sa propre carte : elle n'a pas de budget. */
  private isSavingsCategory(c: Category): boolean {
    return nameKey(c.name) === 'epargne';
  }

  /** Budgets du mois affiché, avec le dépensé et l'état de chacun. Seul `categoryName` dépend des catégories. */
  readonly currentBudgetRows = computed(() => {
    const cm = this.currentMonth();
    if (!cm) return [];
    const tx = this.currentMonthTransactions();
    const cats = this.categories();
    return this.monthBudgets()
      .filter((b) => b.month_id === cm.id)
      .map((b) => {
        const cat = cats.find((c) => c.id === b.category_id);
        const spent = budgetSpent(tx, b.category_id, b.include_fixed);
        const remaining = Math.round((b.amount - spent) * 100) / 100;
        return {
          budget: b,
          categoryName: cat?.name ?? 'Catégorie supprimée',
          archived: !!cat?.archived,
          spent,
          remaining,
          ratio: b.amount > 0 ? spent / b.amount : spent > 0 ? 1 : 0,
          status: budgetStatus(spent, b.amount),
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'fr'));
  });

  /** Reste à allouer : revenus du mois moins épargne moins budgets. Négatif = tu alloues plus que tes revenus. */
  readonly budgetAllocation = computed(() => {
    const s = this.currentSummary();
    if (!s) return null;
    const total = Math.round(this.currentBudgetRows().reduce((a, r) => a + r.budget.amount, 0) * 100) / 100;
    return { income: s.income, savings: s.savings, total, left: Math.round((s.income - s.savings - total) * 100) / 100 };
  });

  // ------------------------------------------------------------
  // Suggestions de budget (règles dans stats.ts)
  // ------------------------------------------------------------

  /** « Garder mon budget » mémorisé par catégorie, valable jusqu'à ce qu'un nouveau mois soit terminé. Stocké dans le navigateur. */
  readonly dismissedSuggestions = signal<Record<string, string>>(DataService.loadDismissed());

  private static loadDismissed(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem('budget-suggestions-dismissed') ?? '{}') ?? {};
    } catch {
      return {};
    }
  }

  readonly suggestionResult = computed(() =>
    suggestBudgets(this.sortedMonths(), this.transactions(), this.categories())
  );

  /** Suggestions à afficher : celles que tu n'as pas déjà écartées pour la période. */
  readonly budgetSuggestions = computed(() =>
    this.budgetsAvailable()
      ? this.suggestionResult().suggestions.filter((s) => this.dismissedSuggestions()[s.categoryId] !== s.basedOn)
      : []
  );

  dismissSuggestion(s: BudgetSuggestion) {
    const next = { ...this.dismissedSuggestions(), [s.categoryId]: s.basedOn };
    this.dismissedSuggestions.set(next);
    try {
      localStorage.setItem('budget-suggestions-dismissed', JSON.stringify(next));
    } catch {
      /* navigateur sans stockage : le choix vaut pour cette session seulement */
    }
  }

  /**
   * Applique une suggestion : le budget par défaut de la catégorie change, et aussi son budget du mois le plus récent
   * (les mois passés ne bougent jamais).
   */
  async applySuggestion(s: BudgetSuggestion) {
    const cat = this.categories().find((c) => c.id === s.categoryId);
    const includeFixed = cat?.budget_include_fixed !== false;
    await this.setCategoryBudget(s.categoryId, s.suggested, includeFixed);
    const latest = this.sortedMonths()[this.sortedMonths().length - 1];
    if (latest) await this.setMonthBudget(latest.id, s.categoryId, s.suggested, includeFixed);
  }

  /** Catégories qui pourraient recevoir un budget ce mois-ci (ni Épargne, ni archivée, ni déjà budgétée). */
  budgetableCategories(monthId: string): Category[] {
    const has = new Set(this.monthBudgets().filter((b) => b.month_id === monthId).map((b) => b.category_id));
    return this.categories().filter((c) => !c.archived && !this.isSavingsCategory(c) && !has.has(c.id));
  }

  /** Catégories dont le budget par défaut n'a pas encore été copié dans le mois. */
  private defaultBudgetsToCopy(monthId: string): Category[] {
    return this.budgetableCategories(monthId).filter((c) => c.budget_default !== null && c.budget_default !== undefined);
  }

  /** Nombre de budgets par défaut qu'un clic sur "Appliquer mes budgets par défaut" ajouterait (0 = rien à faire). */
  missingDefaultBudgets(monthId: string): number {
    return this.defaultBudgetsToCopy(monthId).length;
  }

  /** Copie dans le mois les budgets par défaut des catégories qui n'en ont pas encore. Valeurs figées, jamais rétroactives. */
  async applyDefaultBudgets(monthId: string): Promise<number> {
    const uid = this.supa.userId!;
    const toCopy = this.defaultBudgetsToCopy(monthId);
    if (toCopy.length === 0) return 0;
    const rows = toCopy.map((c) => ({
      user_id: uid,
      month_id: monthId,
      category_id: c.id,
      amount: c.budget_default as number,
      include_fixed: c.budget_include_fixed !== false,
    }));
    const { data, error } = await this.supa.client.from('month_budgets').insert(rows).select();
    if (error) throw error;
    this.monthBudgets.update((list) => [...list, ...((data ?? []) as MonthBudget[])]);
    return rows.length;
  }

  /** Crée ou modifie le budget d'une catégorie pour un mois ; un montant null le retire. */
  async setMonthBudget(monthId: string, categoryId: string, amount: number | null, includeFixed: boolean) {
    const existing = this.monthBudgets().find((b) => b.month_id === monthId && b.category_id === categoryId);
    if (amount === null) {
      if (!existing) return;
      const { error } = await this.supa.client.from('month_budgets').delete().eq('id', existing.id);
      if (error) throw error;
      this.monthBudgets.update((list) => list.filter((b) => b.id !== existing.id));
      return;
    }
    if (existing) {
      const patch = { amount, include_fixed: includeFixed };
      const { error } = await this.supa.client.from('month_budgets').update(patch).eq('id', existing.id);
      if (error) throw error;
      this.monthBudgets.update((list) => list.map((b) => (b.id === existing.id ? { ...b, ...patch } : b)));
      return;
    }
    const uid = this.supa.userId!;
    const { data, error } = await this.supa.client
      .from('month_budgets')
      .insert({ user_id: uid, month_id: monthId, category_id: categoryId, amount, include_fixed: includeFixed })
      .select()
      .single();
    if (error) throw error;
    this.monthBudgets.update((list) => [...list, data as MonthBudget]);
  }

  // ------------------------------------------------------------
  // Dépenses fixes (référentiel)
  // ------------------------------------------------------------
  async addFixedExpense(fe: Omit<FixedExpense, 'id' | 'user_id' | 'created_at'>) {
    const uid = this.supa.userId!;
    const { data, error } = await this.supa.client
      .from('fixed_expenses')
      .insert({ ...fe, user_id: uid })
      .select()
      .single();
    if (error) throw error;
    this.fixedExpenses.update((list) => [...list, data as FixedExpense]);
  }

  async updateFixedExpense(id: string, patch: Partial<FixedExpense>) {
    const { error } = await this.supa.client.from('fixed_expenses').update(patch).eq('id', id);
    if (error) throw error;
    this.fixedExpenses.update((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async deleteFixedExpense(id: string) {
    const { error } = await this.supa.client.from('fixed_expenses').delete().eq('id', id);
    if (error) throw error;
    this.fixedExpenses.update((list) => list.filter((f) => f.id !== id));
  }

  // ------------------------------------------------------------
  // Transactions
  // ------------------------------------------------------------
  async addTransaction(tx: Omit<Transaction, 'id' | 'user_id' | 'created_at'>) {
    const uid = this.supa.userId!;
    const { data, error } = await this.supa.client
      .from('transactions')
      .insert({ ...tx, user_id: uid })
      .select()
      .single();
    if (error) throw error;
    this.transactions.update((list) => [...list, data as Transaction]);
  }

  async updateTransaction(id: string, patch: Partial<Transaction>) {
    const { error } = await this.supa.client.from('transactions').update(patch).eq('id', id);
    if (error) throw error;
    this.transactions.update((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async deleteTransaction(id: string) {
    const { error } = await this.supa.client.from('transactions').delete().eq('id', id);
    if (error) throw error;
    this.transactions.update((list) => list.filter((t) => t.id !== id));
  }

  /** Supprime plusieurs transactions en une requête. */
  async deleteTransactions(ids: string[]) {
    if (ids.length === 0) return;
    const { error } = await this.supa.client.from('transactions').delete().in('id', ids);
    if (error) throw error;
    const gone = new Set(ids);
    this.transactions.update((list) => list.filter((t) => !gone.has(t.id)));
  }

  /** Déplace plusieurs transactions vers un autre mois (leur date, montant et catégorie ne changent pas). */
  async moveTransactions(ids: string[], monthId: string) {
    if (ids.length === 0) return;
    const { error } = await this.supa.client.from('transactions').update({ month_id: monthId }).in('id', ids);
    if (error) throw error;
    const moved = new Set(ids);
    this.transactions.update((list) => list.map((t) => (moved.has(t.id) ? { ...t, month_id: monthId } : t)));
  }

  // ------------------------------------------------------------
  // Réglages
  // ------------------------------------------------------------
  async updateInitialBalance(value: number) {
    const uid = this.supa.userId!;
    const { error } = await this.supa.client
      .from('user_settings')
      .update({ initial_balance: value, updated_at: new Date().toISOString() })
      .eq('user_id', uid);
    if (error) throw error;
    this.settings.update((s) => (s ? { ...s, initial_balance: value } : s));
  }

  // ------------------------------------------------------------
  // Mois : sélection, correction du solde, rapprochement
  // ------------------------------------------------------------
  selectMonth(id: string) {
    const m = this.months().find((mm) => mm.id === id);
    if (m) this.currentMonth.set(m);
  }

  async setMonthStatus(id: string, status: 'current' | 'closed') {
    const { error } = await this.supa.client.from('months').update({ status }).eq('id', id);
    if (error) throw error;
    this.months.update((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
    const cm = this.currentMonth();
    if (cm?.id === id) this.currentMonth.set({ ...cm, status });
  }

  async setStartingBalanceOverride(id: string, value: number | null) {
    const { error } = await this.supa.client
      .from('months')
      .update({ starting_balance_override: value })
      .eq('id', id);
    if (error) throw error;
    this.months.update((list) =>
      list.map((m) => (m.id === id ? { ...m, starting_balance_override: value } : m))
    );
    const cm = this.currentMonth();
    if (cm?.id === id) this.currentMonth.set({ ...cm, starting_balance_override: value });
  }

  /**
   * Fixe le solde de début d'un mois. Un seul chemin pour toute l'app :
   * pour le premier mois c'est le solde initial du suivi, sinon une valeur forcée (null = report automatique).
   */
  async setMonthStart(id: string, value: number | null) {
    if (this.isFirstMonth(id)) {
      if (value !== null) await this.updateInitialBalance(value);
      const first = this.months().find((m) => m.id === id);
      if (first && first.starting_balance_override !== null && first.starting_balance_override !== undefined) {
        await this.setStartingBalanceOverride(id, null);
      }
      return;
    }
    await this.setStartingBalanceOverride(id, value);
  }

  async setRealBalanceCheck(id: string, value: number | null) {
    const { error } = await this.supa.client
      .from('months')
      .update({ real_balance_check: value })
      .eq('id', id);
    if (error) throw error;
    this.months.update((list) =>
      list.map((m) => (m.id === id ? { ...m, real_balance_check: value } : m))
    );
    const cm = this.currentMonth();
    if (cm?.id === id) this.currentMonth.set({ ...cm, real_balance_check: value });
  }

  monthLabel(dateStr: string): string {
    return formatMonthLabel(dateStr);
  }

  /**
   * Crée le mois suivant, VIDE : clôture (étiquette) le mois courant, crée le mois, puis bascule
   * l'affichage dessus. Les dépenses fixes s'ajoutent ensuite à la demande (addFixedExpensesToMonth).
   */
  async generateNextMonth(): Promise<{ month: MonthRow; created: boolean }> {
    const uid = this.supa.userId!;
    const cm = this.currentMonth();
    const last = cm ?? this.sortedMonths()[this.sortedMonths().length - 1];
    if (!last) throw new Error('Aucun mois existant pour partir.');

    const nextDate = toMonthDateString(addMonths(new Date(last.month_date + 'T00:00:00'), 1));

    const existing = this.months().find((m) => m.month_date === nextDate);
    if (existing) {
      this.currentMonth.set(existing);
      return { month: existing, created: false };
    }

    if (last.status === 'current') {
      await this.setMonthStatus(last.id, 'closed');
    }

    const { data: newMonth, error: monthErr } = await this.supa.client
      .from('months')
      .insert({ user_id: uid, month_date: nextDate, status: 'current' })
      .select()
      .single();
    if (monthErr) throw monthErr;
    const month = newMonth as MonthRow;
    this.months.update((list) => [...list, month]);
    this.currentMonth.set(month);
    return { month, created: true };
  }

  /**
   * Copie dans le mois les dépenses fixes ACTIVES du référentiel qui n'y figurent pas déjà.
   * - Valeurs figées au moment de la copie (jamais rétroactives).
   * - Un montant qui n'est pas mensuel est réparti : chaque mois reçoit sa part (voir fixed-expense.ts).
   * - Sans doublon : une dépense fixe déjà présente dans le mois (même nom, sans tenir compte
   *   des majuscules, des accents ni des espaces autour) n'est pas recopiée.
   */
  async addFixedExpensesToMonth(monthId: string): Promise<{ added: number; alreadyThere: number; active: number }> {
    const uid = this.supa.userId!;
    const month = this.months().find((m) => m.id === monthId);
    if (!month) throw new Error('Mois introuvable.');

    const { active, toAdd, alreadyThere } = this.planFixedExpenses(monthId);

    if (toAdd.length > 0) {
      const rows = toAdd.map((f) => ({
        user_id: uid,
        month_id: monthId,
        type: 'fixed' as const,
        name: f.name,
        amount: monthlyShare(f.amount, f.frequency),
        category_id: f.category_id,
        tx_date: buildDate(month.month_date, f.payment_day),
        detail: fixedExpenseDetail(f.amount, f.frequency),
        necessary: null,
        received: null,
      }));
      const { data: inserted, error } = await this.supa.client.from('transactions').insert(rows).select();
      if (error) throw error;
      this.transactions.update((list) => [...list, ...((inserted ?? []) as Transaction[])]);
    }

    return { added: toAdd.length, alreadyThere, active: active.length };
  }

  /** Ce que "Ajouter les dépenses fixes" ferait pour ce mois : actives du référentiel, à ajouter, déjà présentes. */
  planFixedExpenses(monthId: string): { active: FixedExpense[]; toAdd: FixedExpense[]; alreadyThere: number } {
    const active = this.fixedExpenses().filter((f) => f.active);

    // Compteur des noms déjà présents (deux dépenses fixes de même nom restent possibles)
    const present = new Map<string, number>();
    for (const t of this.transactions()) {
      if (t.month_id !== monthId || t.type !== 'fixed') continue;
      const key = nameKey(t.name);
      present.set(key, (present.get(key) ?? 0) + 1);
    }

    const toAdd: FixedExpense[] = [];
    let alreadyThere = 0;
    for (const f of active) {
      const key = nameKey(f.name);
      const left = present.get(key) ?? 0;
      if (left > 0) {
        present.set(key, left - 1);
        alreadyThere++;
      } else {
        toAdd.push(f);
      }
    }
    return { active, toAdd, alreadyThere };
  }

  /**
   * Dépenses fixes déjà présentes dans le mois dont la date n'est plus celle du jour de prélèvement du référentiel
   * (jour modifié après leur ajout au mois). Même appariement par nom que addFixedExpensesToMonth.
   * Sert à proposer une mise à jour : rien n'est modifié ici.
   */
  fixedDateChanges(monthId: string): { id: string; name: string; from: string | null; to: string | null }[] {
    const month = this.months().find((m) => m.id === monthId);
    if (!month) return [];
    const present = new Map<string, Transaction[]>();
    for (const t of this.transactions()) {
      if (t.month_id !== monthId || t.type !== 'fixed') continue;
      const key = nameKey(t.name);
      present.set(key, [...(present.get(key) ?? []), t]);
    }
    const changes: { id: string; name: string; from: string | null; to: string | null }[] = [];
    for (const f of this.fixedExpenses().filter((x) => x.active)) {
      const t = present.get(nameKey(f.name))?.shift();
      if (!t) continue;
      const to = buildDate(month.month_date, f.payment_day);
      if ((t.tx_date ?? null) !== to) changes.push({ id: t.id, name: t.name, from: t.tx_date ?? null, to });
    }
    return changes;
  }

  /** Applique les nouvelles dates proposées par fixedDateChanges (la date seulement : montant, catégorie et détail ne bougent pas). */
  async applyFixedDateChanges(changes: { id: string; to: string | null }[]) {
    for (const c of changes) await this.updateTransaction(c.id, { tx_date: c.to });
  }

  /**
   * Applique un plan d'import Excel (voir core/excel/excel-import.ts), par lots.
   * Ordre : réglage, catégories, mois, dépenses fixes, transactions. Puis tout est rechargé.
   * - includeDoubtful : identifiants des lignes "à vérifier" que l'utilisateur a cochées ;
   * - deleteMissing : supprime aussi les lignes de l'application absentes du fichier.
   * Si une étape échoue, les étapes précédentes restent appliquées : l'erreur le précise.
   */
  async applyImportPlan(
    plan: ImportPlan,
    opts: { includeDoubtful: ReadonlySet<string>; deleteMissing: boolean }
  ): Promise<ImportResult> {
    const uid = this.supa.userId!;
    const db = this.supa.client;
    const ops = plan.ops;
    const doubtful = new Set(plan.lines.filter((l) => l.action === 'doubtful').map((l) => l.id));
    const wanted = (lineId: string) => !doubtful.has(lineId) || opts.includeDoubtful.has(lineId);
    const result: ImportResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
    result.skipped = [...doubtful].filter((id) => !opts.includeDoubtful.has(id)).length;
    let step = 'réglage';

    try {
      if (ops.initialBalance !== null) {
        await this.updateInitialBalance(ops.initialBalance);
        result.updated++;
      }

      step = 'catégories';
      if (ops.createCategories.length > 0) {
        const base = this.categories().length;
        const rows = ops.createCategories.map((name, i) => ({ user_id: uid, name, sort_order: base + i }));
        const { data, error } = await db.from('categories').insert(rows).select();
        if (error) throw error;
        this.categories.update((list) => [...list, ...((data ?? []) as Category[])]);
        result.created += rows.length;
      }
      const catId = (name: string | null | undefined) =>
        name ? this.categories().find((c) => nameKey(c.name) === nameKey(name))?.id ?? null : null;

      step = 'mois';
      if (ops.createMonths.length > 0) {
        const rows = ops.createMonths.map((m) => ({
          user_id: uid,
          month_date: m.key + '-01',
          status: m.status,
          starting_balance_override: m.override,
          real_balance_check: m.real,
        }));
        const { data, error } = await db.from('months').insert(rows).select();
        if (error) throw error;
        this.months.update((list) => [...list, ...((data ?? []) as MonthRow[])]);
        result.created += rows.length;
      }
      for (const u of ops.updateMonths) {
        const { error } = await db.from('months').update(u.patch).eq('id', u.id);
        if (error) throw error;
        result.updated++;
      }
      const monthIdByKey = new Map(this.months().map((m) => [m.month_date.slice(0, 7), m.id]));

      step = 'dépenses fixes';
      const newFixed = ops.createFixed.filter((o) => wanted(o.lineId));
      for (const part of chunk(newFixed, 200)) {
        const rows = part.map((o) => ({
          user_id: uid,
          name: o.data.name,
          amount: o.data.amount,
          category_id: catId(o.data.categoryName),
          frequency: o.data.frequency,
          payment_day: o.data.payment_day,
          active: o.data.active,
        }));
        const { error } = await db.from('fixed_expenses').insert(rows);
        if (error) throw error;
        result.created += rows.length;
      }
      const fixedById = new Map(this.fixedExpenses().map((f) => [f.id, f]));
      const fixedRows = ops.updateFixed
        .map((u) => {
          const cur = fixedById.get(u.id);
          if (!cur) return null;
          const { categoryName, ...rest } = u.patch;
          return { ...cur, ...rest, ...('categoryName' in u.patch ? { category_id: catId(categoryName) } : {}) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      for (const part of chunk(fixedRows, 200)) {
        const { error } = await db.from('fixed_expenses').upsert(part, { onConflict: 'id' });
        if (error) throw error;
        result.updated += part.length;
      }
      if (opts.deleteMissing) {
        for (const part of chunk(ops.deleteFixed, 50)) {
          const { error } = await db.from('fixed_expenses').delete().in('id', part.map((d) => d.id));
          if (error) throw error;
          result.deleted += part.length;
        }
      }

      step = 'transactions';
      const monthId = (key: string) => {
        const id = monthIdByKey.get(key);
        if (!id) throw new Error(`Mois ${key} introuvable.`);
        return id;
      };
      const newTx = ops.createTx.filter((o) => wanted(o.lineId));
      for (const part of chunk(newTx, 300)) {
        const rows = part.map((o) => ({
          user_id: uid,
          month_id: monthId(o.data.monthKey),
          type: o.data.type,
          name: o.data.name,
          amount: o.data.amount,
          category_id: catId(o.data.categoryName),
          tx_date: o.data.tx_date,
          detail: o.data.detail,
          necessary: o.data.necessary,
          received: o.data.received,
        }));
        const { error } = await db.from('transactions').insert(rows);
        if (error) throw error;
        result.created += rows.length;
      }
      const txById = new Map(this.transactions().map((t) => [t.id, t]));
      const txRows = ops.updateTx
        .map((u) => {
          const cur = txById.get(u.id);
          if (!cur) return null;
          const { monthKey, categoryName, ...rest } = u.patch;
          return {
            ...cur,
            ...rest,
            ...(monthKey !== undefined ? { month_id: monthId(monthKey) } : {}),
            ...('categoryName' in u.patch ? { category_id: catId(categoryName) } : {}),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      for (const part of chunk(txRows, 300)) {
        const { error } = await db.from('transactions').upsert(part, { onConflict: 'id' });
        if (error) throw error;
        result.updated += part.length;
      }
      if (opts.deleteMissing) {
        for (const part of chunk(ops.deleteTx, 50)) {
          const { error } = await db.from('transactions').delete().in('id', part.map((d) => d.id));
          if (error) throw error;
          result.deleted += part.length;
        }
      }
      return result;
    } catch (e: any) {
      const done = `${result.created} ajoutée(s), ${result.updated} modifiée(s), ${result.deleted} supprimée(s) avant l'erreur`;
      throw new Error(`Import interrompu à l'étape « ${step} » : ${e?.message ?? e}. (${done}.)`);
    } finally {
      await this.loadAll();
    }
  }
}

export interface ImportResult {
  created: number;
  updated: number;
  deleted: number;
  /** Lignes "à vérifier" laissées de côté. */
  skipped: number;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Clé de comparaison de deux noms : sans majuscules, accents ni espaces autour. */
function nameKey(name: string): string {
  return name.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase().trim();
}

/**
 * Date de la transaction créée depuis une dépense fixe : exactement le jour saisi, sans jour saisi pas de date.
 * Seul cas où le jour change : il n'existe pas dans le mois (30 ou 31 en février, 31 en avril...), on prend alors le dernier jour du mois.
 */
function buildDate(monthDate: string, day: number | null): string | null {
  if (day === null || day === undefined) return null;
  const [y, m] = monthDate.split('-');
  const last = daysInMonth(Number(y), Number(m));
  return `${y}-${m}-${String(Math.min(Math.max(day, 1), last)).padStart(2, '0')}`;
}
