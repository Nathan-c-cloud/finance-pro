import { Account, FixedExpense, MonthBudget, MonthRow, Transaction } from '../models/models';
import { addMonths, toMonthDateString } from './calc';

/**
 * Logique pure des comptes : quel compte est affiché, quelles données lui appartiennent.
 * Rien ici ne touche à la base ni à l'écran, pour pouvoir la tester seule.
 *
 * Une transaction et un budget de mois n'ont pas d'account_id : ils appartiennent au compte de leur mois.
 */

/** Plus ancien d'abord (création), l'identifiant départage deux comptes créés au même instant. */
function byCreation(a: Account, b: Account): number {
  return (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id);
}

/**
 * Compte à afficher : celui mémorisé s'il existe encore, sinon le plus ancien compte actif
 * (ou, à défaut, le plus ancien compte). Null seulement si l'utilisateur n'a aucun compte.
 */
export function pickCurrentAccount(accounts: Account[], storedId: string | null): Account | null {
  if (accounts.length === 0) return null;
  const stored = storedId ? accounts.find((a) => a.id === storedId) : undefined;
  if (stored) return stored;
  const sorted = [...accounts].sort(byCreation);
  return sorted.find((a) => a.status === 'active') ?? sorted[0];
}

/** Mois d'un compte, du plus ancien au plus récent. Sans compte choisi : aucun mois. */
export function monthsOfAccount(months: MonthRow[], accountId: string | null): MonthRow[] {
  if (!accountId) return [];
  return months.filter((m) => m.account_id === accountId).sort((a, b) => a.month_date.localeCompare(b.month_date));
}

export function fixedExpensesOfAccount(fixed: FixedExpense[], accountId: string | null): FixedExpense[] {
  if (!accountId) return [];
  return fixed.filter((f) => f.account_id === accountId);
}

/** Transactions appartenant à l'un de ces mois (donc au compte de ces mois). */
export function transactionsOfMonths(transactions: Transaction[], months: MonthRow[]): Transaction[] {
  const ids = new Set(months.map((m) => m.id));
  return transactions.filter((t) => ids.has(t.month_id));
}

export function budgetsOfMonths(budgets: MonthBudget[], months: MonthRow[]): MonthBudget[] {
  const ids = new Set(months.map((m) => m.id));
  return budgets.filter((b) => ids.has(b.month_id));
}

/** Mois à afficher à l'ouverture d'un compte : le premier marqué "courant", sinon le plus récent. */
export function pickMonthToShow(months: MonthRow[]): MonthRow | null {
  if (months.length === 0) return null;
  return months.find((m) => m.status === 'current') ?? months[months.length - 1];
}

/** Comparaison de deux noms de compte : sans majuscules, accents ni espaces autour. */
function accountKey(name: string): string {
  return name.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase().trim();
}

export const ACCOUNT_NAME_MAX = 40;

/**
 * Raison pour laquelle un nom de compte est refusé (texte prêt à afficher), ou null s'il convient.
 * `ignoreId` : le compte qu'on est en train de renommer, qui ne compte pas comme un doublon de lui même.
 */
export function accountNameError(name: string, accounts: Account[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Donne un nom à ce compte.';
  if (trimmed.length > ACCOUNT_NAME_MAX) return `Le nom est trop long (${ACCOUNT_NAME_MAX} caractères au maximum).`;
  const key = accountKey(trimmed);
  if (accounts.some((a) => a.id !== ignoreId && accountKey(a.name) === key)) return 'Un compte porte déjà ce nom.';
  return null;
}

/**
 * Mois de départ proposés à la création d'un compte : du mois en cours jusqu'à `count - 1` mois en arrière,
 * le plus récent d'abord, au format 'YYYY-MM-01'.
 */
export function startMonthOptions(today: Date, count = 36): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(toMonthDateString(addMonths(today, -i)));
  return out;
}
