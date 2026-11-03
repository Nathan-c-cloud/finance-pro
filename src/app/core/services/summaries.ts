import { Account, Category, MonthRow, MonthSummary, Transaction } from '../models/models';
import { summarizeMonth } from './calc';

/**
 * Résumés de tous les mois d'UN compte, dans l'ordre, soldes reportés en chaîne.
 * Fonction pure : le DataService l'appelle pour le compte affiché et, pour la vue « Tous les comptes », pour chaque compte.
 *
 * `months` : les mois du compte, du plus ancien au plus récent ; `transactions` : celles de ces mois.
 */
export function buildAccountSummaries(input: {
  account: Account | null;
  months: MonthRow[];
  transactions: Transaction[];
  categories: Category[];
  /** Comptes d'épargne de l'utilisateur : un virement avec l'un d'eux compte comme de l'épargne. */
  savingsAccountIds: ReadonlySet<string>;
  /** Mouvements directs des comptes d'épargne par mois ('YYYY-MM-01'), à compter dans CE compte (voir summarizeMonth). */
  savingsFlows: ReadonlyMap<string, number>;
}): MonthSummary[] {
  const { account, months, transactions, categories, savingsAccountIds, savingsFlows } = input;
  const byMonth = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const list = byMonth.get(t.month_id);
    if (list) list.push(t);
    else byMonth.set(t.month_id, [t]);
  }

  const summaries: MonthSummary[] = [];
  // Le solde de départ appartient au compte (chaque compte repart de son propre solde).
  let carry = account?.opening_balance ?? 0;
  months.forEach((m, i) => {
    const tx = byMonth.get(m.id) ?? [];
    const own = m.starting_balance_override;
    // Premier mois : son solde de début est le solde initial du suivi (une éventuelle ancienne valeur forcée prime).
    // Autres mois : ils reprennent la fin du mois précédent, qui peut elle même être forcée (voir ci dessous).
    const startingBalance = i === 0 && own !== null && own !== undefined ? own : carry;
    // Un recalage depuis le mois suivant force le solde de FIN de ce mois : la valeur est stockée sur le mois suivant
    // (starting_balance_override), et c'est ce mois ci qui l'affiche comme "solde forcé de fin de mois".
    const nextOverride = months[i + 1]?.starting_balance_override;
    const forcedEnd = nextOverride !== null && nextOverride !== undefined ? nextOverride : null;
    const s = summarizeMonth(m, tx, categories, startingBalance, forcedEnd, savingsAccountIds, savingsFlows.get(m.month_date) ?? 0);
    summaries.push(s);
    carry = s.endingBalance;
  });
  return summaries;
}
