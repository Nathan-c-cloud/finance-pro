import { Category, MonthRow, MonthSummary, Transaction } from '../models/models';

/**
 * Toutes les fonctions ici sont pures : mêmes entrées -> mêmes sorties.
 * Rien n'est stocké tel quel en base, tout est recalculé à l'affichage,
 * exactement comme les formules du fichier Excel d'origine.
 */

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

/**
 * Construit le résumé complet d'un mois à partir de ses transactions.
 * `startingBalance` est calculé en amont par le DataService, qui enchaîne
 * les mois dans l'ordre (solde de fin d'un mois = solde de début du suivant,
 * sauf override manuel) — cette fonction reste pure et sans dépendance d'ordre.
 */
export function summarizeMonth(
  month: MonthRow,
  transactions: Transaction[],
  categories: Category[],
  startingBalance: number
): MonthSummary {
  const income = sum(transactions.filter((t) => t.type === 'income').map((t) => t.amount));

  const savingsCategoryIds = new Set(
    categories.filter((c) => normalize(c.name) === 'epargne').map((c) => c.id)
  );

  const savings = sum(
    transactions
      .filter((t) => t.category_id && savingsCategoryIds.has(t.category_id))
      .map((t) => t.amount)
  );

  const expensesExcludingSavings = sum(
    transactions
      .filter((t) => t.type !== 'income' && !(t.category_id && savingsCategoryIds.has(t.category_id)))
      .map((t) => t.amount)
  );

  const fixedExpensesExcludingSavings = sum(
    transactions
      .filter(
        (t) =>
          t.type === 'fixed' && !(t.category_id && savingsCategoryIds.has(t.category_id))
      )
      .map((t) => t.amount)
  );

  const remainingBeforeVariable = income - fixedExpensesExcludingSavings;
  const endingBalance = startingBalance + income - expensesExcludingSavings - savings;
  const savingsRate = income > 0 ? savings / income : 0;

  const byCategoryMap = new Map<string, { categoryId: string | null; categoryName: string; amount: number }>();
  for (const cat of categories) {
    byCategoryMap.set(cat.id, { categoryId: cat.id, categoryName: cat.name, amount: 0 });
  }
  for (const t of transactions) {
    if (t.type === 'income') continue;
    const key = t.category_id ?? '__none__';
    if (!byCategoryMap.has(key)) {
      byCategoryMap.set(key, {
        categoryId: t.category_id,
        categoryName: t.category_id ? 'Catégorie supprimée' : 'Sans catégorie',
        amount: 0,
      });
    }
    byCategoryMap.get(key)!.amount += t.amount;
  }

  return {
    month,
    startingBalance,
    income,
    expensesExcludingSavings,
    savings,
    remainingBeforeVariable,
    endingBalance,
    savingsRate,
    byCategory: Array.from(byCategoryMap.values()),
  };
}

function normalize(s: string): string {
  const combiningMarks = new RegExp('[̀-ͯ]', 'g');
  return s.normalize('NFD').replace(combiningMarks, '').toLowerCase().trim();
}

/** Solde "théorique à aujourd'hui" pour le rapprochement bancaire :
 *  ne compte que les mouvements dont la date est déjà passée. */
export function theoreticalBalanceToday(
  startingBalance: number,
  transactions: Transaction[],
  categories: Category[],
  today: Date = new Date()
): number {
  const savingsCategoryIds = new Set(
    categories.filter((c) => normalize(c.name) === 'epargne').map((c) => c.id)
  );
  const isPastOrToday = (t: Transaction) => {
    if (!t.tx_date) return true; // pas de date = considérée déjà survenue
    return new Date(t.tx_date + 'T00:00:00') <= today;
  };
  const income = sum(transactions.filter((t) => t.type === 'income' && isPastOrToday(t)).map((t) => t.amount));
  const outflows = sum(
    transactions
      .filter((t) => t.type !== 'income' && isPastOrToday(t))
      .map((t) => t.amount)
  );
  return startingBalance + income - outflows;
}

export function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

export function toMonthDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
