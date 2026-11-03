import { Account, FixedExpense, MonthRow, MonthSummary, Transaction } from '../models/models';
import { monthsOfAccount, transactionsOfMonths } from './account-scope';
import { pendingOperations, toMonthDateString } from './calc';
import { balanceAt } from './consolidated';

/**
 * Clôture d'un compte. Un compte ne se supprime jamais : il passe à « clôturé », sort du total de tes comptes, et son
 * historique reste consultable.
 */

/**
 * Pourquoi ce compte ne peut pas être clôturé maintenant, ou null s'il le peut.
 *  - il faut garder au moins un compte actif ;
 *  - aucune opération ne doit rester à venir : sinon le solde à déplacer est faux, et un virement à venir laisserait
 *    l'autre compte avec une moitié orpheline.
 */
export function closureBlocker(input: {
  account: Account;
  accounts: readonly Account[];
  months: readonly MonthRow[];
  transactions: readonly Transaction[];
  today: Date;
}): string | null {
  const { account, accounts, months, transactions, today } = input;
  if (account.status !== 'active') return 'Ce compte est déjà clôturé.';
  if (!accounts.some((a) => a.status === 'active' && a.id !== account.id)) {
    return "C'est ton dernier compte actif : crée un autre compte avant de clôturer celui-ci.";
  }
  const own = transactionsOfMonths([...transactions], monthsOfAccount([...months], account.id));
  const pending = pendingOperations(own, today).items;
  if (pending.length > 0) {
    const names = pending.slice(0, 3).map((t) => `« ${t.name} »`).join(', ');
    const more = pending.length > 3 ? ` et ${pending.length - 3} autre${pending.length - 3 > 1 ? 's' : ''}` : '';
    return (
      `Il reste ${pending.length} opération${pending.length > 1 ? 's' : ''} pas encore réalisée${pending.length > 1 ? 's' : ''} ` +
      `sur ce compte : ${names}${more}. Supprime-les, ou règle-les (date passée, case « Reçu » cochée pour un revenu), ` +
      `puis reviens clôturer le compte.`
    );
  }
  return null;
}

/** Argent qui reste sur le compte à `today` : le solde de fin de son mois du jour (ou de son dernier mois avant). */
export function remainingBalance(account: Account, summaries: readonly MonthSummary[], today: Date): number {
  return Math.round(balanceAt(account, [...summaries], toMonthDateString(today)) * 100) / 100;
}

/**
 * Dépenses fixes actives à arrêter avec le compte : celles du compte lui même, et celles des autres comptes qui
 * virent vers lui (un compte clôturé ne peut plus recevoir de virement).
 */
export function closureFixedExpenses(accountId: string, fixed: readonly FixedExpense[]): FixedExpense[] {
  return fixed.filter((f) => f.active && (f.account_id === accountId || f.transfer_account_id === accountId));
}

/** Date locale 'aaaa-mm-jj' (pas celle de l'UTC : à minuit passé à Paris, l'UTC est encore la veille). */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
