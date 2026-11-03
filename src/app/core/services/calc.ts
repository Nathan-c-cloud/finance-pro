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
  allTransactions: Transaction[],
  categories: Category[],
  startingBalance: number,
  /** Solde de fin forcé (le mois suivant a recalé le solde sur la banque), ou null pour le solde calculé. */
  forcedEnd: number | null = null,
  /** Comptes de type épargne de l'utilisateur : un virement avec l'un d'eux compte comme de l'épargne. */
  savingsAccountIds: ReadonlySet<string> = new Set()
): MonthSummary {
  // Un virement entre comptes n'est ni un revenu ni une dépense : il est traité à part.
  const transactions = allTransactions.filter((t) => !isTransfer(t));
  const transfers = allTransactions.filter(isTransfer);

  const income = sum(transactions.filter((t) => t.type === 'income').map((t) => t.amount));

  const savingsCategoryIds = new Set(
    categories.filter((c) => normalize(c.name) === 'epargne').map((c) => c.id)
  );

  // Virement vers un compte d'épargne : de l'épargne. Retrait depuis un compte d'épargne : de l'épargne en moins,
  // seulement dans le mois où il a lieu (le taux des mois passés ne bouge pas).
  const toSavings = (t: Transaction) => !!t.transfer_account_id && savingsAccountIds.has(t.transfer_account_id);
  const signed = (t: Transaction) => (t.type === 'income' ? t.amount : -t.amount); // effet sur le solde

  const transferSavings = sum(transfers.filter(toSavings).map((t) => -signed(t)));
  const transfersNet = sum(transfers.filter((t) => !toSavings(t)).map(signed));

  const savings =
    sum(
      transactions
        .filter((t) => t.category_id && savingsCategoryIds.has(t.category_id))
        .map((t) => t.amount)
    ) + transferSavings;

  const expensesExcludingSavings = sum(
    transactions
      .filter((t) => t.type !== 'income' && !(t.category_id && savingsCategoryIds.has(t.category_id)))
      .map((t) => t.amount)
  );

  const computedEndingBalance = startingBalance + income - expensesExcludingSavings - savings + transfersNet;
  const endingForced = forcedEnd !== null;
  const endingBalance = endingForced ? forcedEnd : computedEndingBalance;
  const accountChange = endingBalance - startingBalance;
  // Taux d'épargne = épargne / revenus du mois. Non défini (null, affiché "—") quand il n'a pas de sens :
  // aucun revenu saisi, ou épargne supérieure aux revenus (taux au dessus de 100 %).
  // Négatif quand on a retiré de l'épargne dans le mois.
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
    transfersNet,
    byCategory: Array.from(byCategoryMap.values()),
  };
}

/** Une ligne de virement entre comptes (l'une des deux moitiés d'un virement). */
export function isTransfer(t: Transaction): boolean {
  return !!t.transfer_id;
}

/** Une opération a déjà eu lieu à `today` : un virement (des deux côtés), une dépense, par sa date ; un revenu, s'il est coché "Reçu". */
function isDone(t: Transaction, today: Date): boolean {
  if (t.type === 'income' && !isTransfer(t)) return t.received === true;
  if (!t.tx_date) return false;
  return new Date(t.tx_date + 'T00:00:00') <= today;
}

export function normalize(s: string): string {
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
  const effect = sum(
    transactions.filter((t) => isDone(t, today)).map((t) => (t.type === 'income' ? t.amount : -t.amount))
  );
  return startingBalance + effect;
}

/**
 * Pistes pour expliquer un écart de rapprochement (solde réel moins solde théorique) :
 * les revenus pas encore cochés "Reçu" (qui gonflent l'écart) et les dépenses datées plus tard
 * et les dépenses datées plus tard ou sans date (pas comptées dans le théorique d'aujourd'hui, donc possiblement déjà prélevées).
 */
export function gapClues(transactions: Transaction[], today: Date = new Date()) {
  const unreceivedIncomes = transactions.filter((t) => t.type === 'income' && !isTransfer(t) && t.received !== true);
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
 * Opérations d'un mois pas encore réalisées à la date d'aujourd'hui : dépenses sans date ou datées plus tard,
 * revenus pas cochés "Reçu". Elles comptent pourtant dans le solde de fin de mois (donc dans le solde de début
 * du mois suivant), alors qu'elles ne sont pas passées sur le compte.
 * `net` est leur effet sur le solde de fin : revenus en plus, dépenses (épargne comprise) en moins.
 */
export function pendingOperations(transactions: Transaction[], today: Date = new Date()) {
  const items = transactions.filter((t) => !isDone(t, today));
  const net = sum(items.map((t) => (t.type === 'income' ? t.amount : -t.amount)));
  return { items, net: Math.round(net * 100) / 100 };
}

/**
 * Revenu dont la date est déjà passée (avant aujourd'hui) mais qui n'est pas coché "Reçu" :
 * probablement à cocher, sinon il fausse le solde théorique d'aujourd'hui.
 */
export function isLateIncome(t: Transaction, today: Date = new Date()): boolean {
  if (t.type !== 'income' || isTransfer(t) || t.received === true || !t.tx_date) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(t.tx_date + 'T00:00:00') < startOfToday;
}

/** Seuils d'alerte d'un budget : en dessous de 80 % tout va bien, jusqu'à 100 % c'est serré, au dessus c'est dépassé. */
export type BudgetStatus = 'ok' | 'warn' | 'over';

/**
 * Dépensé pour un budget : dépenses de la catégorie dans le mois (revenus exclus).
 * Quand `includeFixed` est faux, les dépenses fixes de la catégorie ne comptent pas (ex. loyer dans Logement).
 */
export function budgetSpent(transactions: Transaction[], categoryId: string, includeFixed: boolean): number {
  return Math.round(
    sum(
      transactions
        .filter((t) => t.type !== 'income' && !isTransfer(t) && t.category_id === categoryId && (includeFixed || t.type !== 'fixed'))
        .map((t) => t.amount)
    ) * 100
  ) / 100;
}

export function budgetStatus(spent: number, amount: number): BudgetStatus {
  if (spent > amount + 0.005) return 'over';
  return amount > 0 && spent / amount >= 0.8 ? 'warn' : 'ok';
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
