import { Account, MonthSummary } from '../models/models';
import { addMonths, toMonthDateString } from './calc';

/**
 * Vue « Tous les comptes » : calculs purs à partir des résumés de chaque compte (voir summaries.ts).
 *
 * Règles :
 *  - un virement entre deux comptes de l'utilisateur n'est ni un revenu ni une dépense : il ne change que les soldes
 *    (la somme des soldes ne bouge pas) ;
 *  - revenus, dépenses et épargne du mois sont ceux des comptes COURANTS : l'épargne est déjà comptée par eux
 *    (virements vers l'épargne, retraits, mouvements directs des comptes d'épargne) ;
 *  - le solde d'aujourd'hui ne compte que les comptes actifs : un compte clôturé sort du total ;
 *  - l'historique du total ne change pas : un compte clôturé compte jusqu'au mois précédant sa clôture. Son argent a été
 *    viré ailleurs (le total est alors continu) ou est sorti du suivi (le total baisse dans le mois de la clôture).
 */

export interface AccountBalance {
  account: Account;
  /** Solde de fin du mois retenu (voir balanceAt). */
  balance: number;
  /** Mois retenu ('YYYY-MM-01'), ou null si le compte n'a aucun mois (on retombe sur son solde de départ). */
  monthDate: string | null;
}

export interface ConsolidatedMonth {
  /** 'YYYY-MM-01' */
  monthDate: string;
  income: number;
  expensesExcludingSavings: number;
  savings: number;
  /** Épargne / revenus, ou null quand il n'a pas de sens (aucun revenu, ou épargne supérieure aux revenus). */
  savingsRate: number | null;
  /** Somme des soldes de fin de mois des comptes actifs. */
  totalBalance: number;
}

export interface Consolidated {
  /** Comptes actifs avec leur solde du mois en cours. */
  accounts: AccountBalance[];
  totalBalance: number;
  /** Dont comptes d'épargne. */
  savingsBalance: number;
  /** Du plus ancien au plus récent. */
  months: ConsolidatedMonth[];
  /** Le mois du calendrier à `today` s'il existe dans `months`, sinon le dernier. */
  current: ConsolidatedMonth | null;
}

/**
 * Solde de fin de mois d'un compte à une date : celui de son mois `monthDate`, sinon celui de son dernier mois avant
 * cette date (un compte sans mois récent garde son dernier solde), sinon 0 avant son premier mois (il n'existait pas
 * encore dans le suivi), et son solde de départ s'il n'a aucun mois.
 */
export function balanceAt(account: Account, summaries: MonthSummary[], monthDate: string): number {
  if (summaries.length === 0) return account.opening_balance;
  let found: MonthSummary | null = null;
  for (const s of summaries) {
    if (s.month.month_date <= monthDate) found = s;
    else break;
  }
  return found ? found.endingBalance : 0;
}

/** Un compte actif compte dans le total de chaque mois ; un compte clôturé, seulement avant le mois de sa clôture. */
function countsInTotal(account: Account, monthDate: string): boolean {
  if (account.status === 'active') return true;
  return !!account.closed_at && monthDate < `${account.closed_at.slice(0, 7)}-01`;
}

export function consolidate(
  accounts: Account[],
  summariesByAccount: ReadonlyMap<string, MonthSummary[]>,
  today: Date = new Date()
): Consolidated {
  const todayMonth = toMonthDateString(today);
  const summariesOf = (a: Account) => summariesByAccount.get(a.id) ?? [];
  const active = accounts.filter((a) => a.status === 'active');

  // Tous les mois, du plus ancien au plus récent, sans trou (un mois sans aucune donnée garde les soldes reportés).
  const dates = new Set<string>();
  for (const a of accounts) for (const s of summariesOf(a)) dates.add(s.month.month_date);
  const sorted = [...dates].sort();
  const monthDates: string[] = [];
  if (sorted.length > 0) {
    let d = new Date(sorted[0] + 'T00:00:00');
    const last = sorted[sorted.length - 1];
    for (let guard = 0; guard < 600; guard++) {
      const key = toMonthDateString(d);
      monthDates.push(key);
      if (key >= last) break;
      d = addMonths(d, 1);
    }
  }

  const checking = accounts.filter((a) => a.kind === 'checking');
  const months: ConsolidatedMonth[] = monthDates.map((monthDate) => {
    let income = 0;
    let expenses = 0;
    let savings = 0;
    for (const a of checking) {
      const s = summariesOf(a).find((x) => x.month.month_date === monthDate);
      if (!s) continue;
      income += s.income;
      expenses += s.expensesExcludingSavings;
      savings += s.savings;
    }
    const totalBalance = accounts
      .filter((a) => countsInTotal(a, monthDate))
      .reduce((sum, a) => sum + balanceAt(a, summariesOf(a), monthDate), 0);
    return {
      monthDate,
      income: round2(income),
      expensesExcludingSavings: round2(expenses),
      savings: round2(savings),
      savingsRate: income > 0 && savings <= income ? savings / income : null,
      totalBalance: round2(totalBalance),
    };
  });

  // Solde du mois en cours : celui du mois du calendrier s'il existe, sinon le dernier mois connu.
  const reference = months.find((m) => m.monthDate === todayMonth) ?? months[months.length - 1] ?? null;
  const referenceDate = reference?.monthDate ?? todayMonth;
  const balances: AccountBalance[] = active.map((account) => {
    const summaries = summariesOf(account);
    const monthDate = summaries.length === 0 ? null : (summaries.filter((s) => s.month.month_date <= referenceDate).pop()?.month.month_date ?? null);
    return { account, balance: round2(balanceAt(account, summaries, referenceDate)), monthDate };
  });

  return {
    accounts: balances,
    totalBalance: round2(balances.reduce((sum, b) => sum + b.balance, 0)),
    savingsBalance: round2(balances.filter((b) => b.account.kind === 'savings').reduce((sum, b) => sum + b.balance, 0)),
    months,
    current: reference,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
