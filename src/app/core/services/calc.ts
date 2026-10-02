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
  startingBalance: number,
  /** Solde de fin forcé (le mois suivant a recalé le solde sur la banque), ou null pour le solde calculé. */
  forcedEnd: number | null = null
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

  const computedEndingBalance = startingBalance + income - expensesExcludingSavings - savings;
  const endingForced = forcedEnd !== null;
  const endingBalance = endingForced ? forcedEnd : computedEndingBalance;
  const accountChange = endingBalance - startingBalance;
  // Taux d'épargne = épargne / revenus du mois. Non défini (null, affiché "—") quand il n'a pas de sens :
  // aucun revenu saisi, ou épargne supérieure aux revenus (taux au dessus de 100 %).
  const savingsRate = income > 0 && savings <= income ? savings / income : null;

  const byCategoryMap = new Map<string, { categoryId: string | null; categoryName: string; amount: number }>();
  for (const cat of categories) {
    if (savingsCategoryIds.has(cat.id)) continue; // l'épargne a sa propre carte, hors répartition
    byCategoryMap.set(cat.id, { categoryId: cat.id, categoryName: cat.name, amount: 0 });
  }
  for (const t of transactions) {
    if (t.type === 'income') continue;
    if (t.category_id && savingsCategoryIds.has(t.category_id)) continue;
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
    accountChange,
    endingBalance,
    computedEndingBalance,
    endingForced,
    savingsRate,
    byCategory: Array.from(byCategoryMap.values()),
  };
}

function normalize(s: string): string {
  const combiningMarks = new RegExp('[̀-ͯ]', 'g');
  return s.normalize('NFD').replace(combiningMarks, '').toLowerCase().trim();
}

/** Solde "théorique à aujourd'hui" pour le rapprochement bancaire :
 *  - un revenu compte seulement s'il est coché "Reçu" (sa date n'importe pas) ;
 *  - une dépense (épargne comprise) compte dès que sa date est passée ou aujourd'hui ;
 *    une dépense SANS date n'est pas comptée (on ne sait pas quand elle sort : l'app ne devine rien),
 *    elle reste comptée dans le solde théorique de fin de mois. */
export function theoreticalBalanceToday(
  startingBalance: number,
  transactions: Transaction[],
  today: Date = new Date()
): number {
  const isPastOrToday = (t: Transaction) => {
    if (!t.tx_date) return false; // pas de date = pas comptée aujourd'hui
    return new Date(t.tx_date + 'T00:00:00') <= today;
  };
  const income = sum(transactions.filter((t) => t.type === 'income' && t.received === true).map((t) => t.amount));
  const outflows = sum(
    transactions
      .filter((t) => t.type !== 'income' && isPastOrToday(t))
      .map((t) => t.amount)
  );
  return startingBalance + income - outflows;
}

/**
 * Pistes pour expliquer un écart de rapprochement (solde réel moins solde théorique) :
 * les revenus pas encore cochés "Reçu" (qui gonflent l'écart) et les dépenses datées plus tard
 * et les dépenses datées plus tard ou sans date (pas comptées dans le théorique d'aujourd'hui, donc possiblement déjà prélevées).
 */
export function gapClues(transactions: Transaction[], today: Date = new Date()) {
  const unreceivedIncomes = transactions.filter((t) => t.type === 'income' && t.received !== true);
  const laterExpenses = transactions.filter(
    (t) => t.type !== 'income' && !!t.tx_date && new Date(t.tx_date + 'T00:00:00') > today
  );
  const undatedExpenses = transactions.filter((t) => t.type !== 'income' && !t.tx_date);
  return {
    unreceivedIncomes,
    unreceivedTotal: sum(unreceivedIncomes.map((t) => t.amount)),
    laterExpenses,
    laterTotal: sum(laterExpenses.map((t) => t.amount)),
    undatedExpenses,
    undatedTotal: sum(undatedExpenses.map((t) => t.amount)),
  };
}

/**
 * Revenu dont la date est déjà passée (avant aujourd'hui) mais qui n'est pas coché "Reçu" :
 * probablement à cocher, sinon il fausse le solde théorique d'aujourd'hui.
 */
export function isLateIncome(t: Transaction, today: Date = new Date()): boolean {
  if (t.type !== 'income' || t.received === true || !t.tx_date) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(t.tx_date + 'T00:00:00') < startOfToday;
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

/** Version courte pour les petits écrans : "sept. 2026". */
export function formatMonthLabelShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
