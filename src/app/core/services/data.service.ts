import { Injectable, computed, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  Category,
  FixedExpense,
  MonthRow,
  MonthSummary,
  Transaction,
  UserSettings,
} from '../models/models';
import { addMonths, formatMonthLabel, summarizeMonth, theoreticalBalanceToday, toMonthDateString } from './calc';

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
    for (const m of months) {
      const tx = this.transactions().filter((t) => t.month_id === m.id);
      const startingBalance =
        m.starting_balance_override !== null && m.starting_balance_override !== undefined
          ? m.starting_balance_override
          : carry;
      const s = summarizeMonth(m, tx, cats, startingBalance);
      summaries.push(s);
      carry = s.endingBalance;
    }
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
      .sort((a, b) => (a.tx_date ?? '').localeCompare(b.tx_date ?? ''));
  });

  readonly reconciliation = computed(() => {
    const cm = this.currentMonth();
    const s = this.currentSummary();
    if (!cm || !s) return null;
    const theoretical = theoreticalBalanceToday(
      s.startingBalance,
      this.currentMonthTransactions(),
      this.categories()
    );
    const real = cm.real_balance_check ?? null;
    const gap = real !== null ? real - theoretical : null;
    return { theoretical, real, gap };
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
    this.currentMonth.set(null);
    this.loading.set(false);
  }

  async loadAll() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const uid = this.supa.userId;
      if (!uid) return;

      const [catsRes, fixedRes, monthsRes, txRes, settingsRes] = await Promise.all([
        this.supa.client.from('categories').select('*').order('sort_order'),
        this.supa.client.from('fixed_expenses').select('*').order('created_at'),
        this.supa.client.from('months').select('*').order('month_date'),
        this.supa.client.from('transactions').select('*'),
        this.supa.client.from('user_settings').select('*').maybeSingle(),
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
   * Crée le mois suivant : clôture (étiquette) le mois courant, copie les
   * dépenses fixes ACTIVES du référentiel avec leurs valeurs actuelles
   * (figées, jamais rétroactives), puis bascule l'affichage dessus.
   */
  async generateNextMonth(): Promise<{ month: MonthRow; count: number }> {
    const uid = this.supa.userId!;
    const cm = this.currentMonth();
    const last = cm ?? this.sortedMonths()[this.sortedMonths().length - 1];
    if (!last) throw new Error('Aucun mois existant pour partir.');

    const nextDate = toMonthDateString(addMonths(new Date(last.month_date + 'T00:00:00'), 1));

    const existing = this.months().find((m) => m.month_date === nextDate);
    if (existing) {
      this.currentMonth.set(existing);
      return { month: existing, count: 0 };
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

    const active = this.fixedExpenses().filter((f) => f.active);
    const rows = active.map((f) => ({
      user_id: uid,
      month_id: month.id,
      type: 'fixed' as const,
      name: f.name,
      amount: f.amount,
      category_id: f.category_id,
      tx_date: buildDate(nextDate, f.payment_day),
      detail: 'Prélèvement automatique',
      necessary: null,
      received: null,
    }));

    if (rows.length > 0) {
      const { data: inserted, error: txErr } = await this.supa.client
        .from('transactions')
        .insert(rows)
        .select();
      if (txErr) throw txErr;
      this.transactions.update((list) => [...list, ...((inserted ?? []) as Transaction[])]);
    }

    this.currentMonth.set(month);
    return { month, count: rows.length };
  }

  /**
   * Import en masse depuis le script Python (Excel -> JSON) : catégories,
   * dépenses fixes, mois, transactions. Idempotent par nom/date autant que possible.
   */
  async importFromJson(payload: {
    categories: string[];
    fixedExpenses: { name: string; amount: number; category: string; frequency: string; paymentDay: number; active: boolean }[];
    months: { monthDate: string; status: string; startingBalanceOverride?: number | null; realBalanceCheck?: number | null }[];
    transactions: { monthDate: string; type: string; name: string; amount: number; category: string | null; txDate: string | null; detail?: string | null; necessary?: boolean | null; received?: boolean | null }[];
    initialBalance?: number;
  }) {
    const uid = this.supa.userId!;

    // Catégories : n'insère que celles qui manquent
    const existingNames = new Set(this.categories().map((c) => c.name));
    const toCreate = payload.categories.filter((n) => !existingNames.has(n));
    if (toCreate.length > 0) {
      const base = this.categories().length;
      const rows = toCreate.map((name, i) => ({ user_id: uid, name, sort_order: base + i }));
      const { data, error } = await this.supa.client.from('categories').insert(rows).select();
      if (error) throw error;
      this.categories.update((list) => [...list, ...((data ?? []) as Category[])]);
    }
    const catByName = new Map(this.categories().map((c) => [c.name, c.id]));

    if (payload.initialBalance !== undefined) {
      await this.updateInitialBalance(payload.initialBalance);
    }

    // Dépenses fixes (référentiel)
    if (payload.fixedExpenses.length > 0) {
      const rows = payload.fixedExpenses.map((f) => ({
        user_id: uid,
        name: f.name,
        amount: f.amount,
        category_id: catByName.get(f.category) ?? null,
        frequency: f.frequency === 'annual' ? 'annual' : 'monthly',
        payment_day: f.paymentDay || 1,
        active: f.active,
      }));
      const { data, error } = await this.supa.client.from('fixed_expenses').insert(rows).select();
      if (error) throw error;
      this.fixedExpenses.update((list) => [...list, ...((data ?? []) as FixedExpense[])]);
    }

    // Mois : crée ceux qui manquent
    const existingMonthDates = new Set(this.months().map((m) => m.month_date));
    const monthsToCreate = payload.months.filter((m) => !existingMonthDates.has(m.monthDate));
    let createdMonths: MonthRow[] = [];
    if (monthsToCreate.length > 0) {
      const rows = monthsToCreate.map((m) => ({
        user_id: uid,
        month_date: m.monthDate,
        status: m.status === 'closed' ? 'closed' : 'current',
        starting_balance_override: m.startingBalanceOverride ?? null,
        real_balance_check: m.realBalanceCheck ?? null,
      }));
      const { data, error } = await this.supa.client.from('months').insert(rows).select();
      if (error) throw error;
      createdMonths = (data ?? []) as MonthRow[];
      this.months.update((list) => [...list, ...createdMonths]);
    }
    const monthIdByDate = new Map(this.months().map((m) => [m.month_date, m.id]));

    // Une seule ligne "current" : si l'import a créé/ré-importé plusieurs mois,
    // force les mois antérieurs au plus récent à 'closed'.
    const allDates = [...this.months().map((m) => m.month_date)].sort();
    const latestDate = allDates[allDates.length - 1];
    for (const m of this.months()) {
      if (m.month_date !== latestDate && m.status === 'current') {
        await this.setMonthStatus(m.id, 'closed');
      }
    }

    // Transactions
    if (payload.transactions.length > 0) {
      const rows = payload.transactions
        .map((t) => {
          const monthId = monthIdByDate.get(t.monthDate);
          if (!monthId) return null;
          return {
            user_id: uid,
            month_id: monthId,
            type: t.type as 'fixed' | 'variable' | 'income',
            name: t.name,
            amount: t.amount,
            category_id: t.category ? catByName.get(t.category) ?? null : null,
            tx_date: t.txDate,
            detail: t.detail ?? null,
            necessary: t.necessary ?? null,
            received: t.received ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { data, error } = await this.supa.client.from('transactions').insert(rows).select();
        if (error) throw error;
        this.transactions.update((list) => [...list, ...((data ?? []) as Transaction[])]);
      }
    }

    const current = this.months().find((m) => m.status === 'current');
    if (current) this.currentMonth.set(current);
  }
}

function buildDate(monthDate: string, day: number): string {
  const [y, m] = monthDate.split('-');
  const safeDay = Math.min(Math.max(day || 1, 1), 28);
  return `${y}-${m}-${String(safeDay).padStart(2, '0')}`;
}
