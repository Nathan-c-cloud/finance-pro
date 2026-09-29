import { Frequency } from '../models/models';
import { formatEUR } from './format';

/**
 * Rythmes de prélèvement d'une dépense fixe. Le montant saisi est celui de la période
 * (12 € par an) ; chaque mois reçoit sa part : montant / nombre de mois de la période.
 */
export const FREQUENCIES: { value: Frequency; label: string; months: number; adjective: string }[] = [
  { value: 'monthly', label: 'Mensuelle', months: 1, adjective: 'mensuelle' },
  { value: 'bimonthly', label: 'Tous les 2 mois', months: 2, adjective: 'bimestrielle' },
  { value: 'quarterly', label: 'Trimestrielle', months: 3, adjective: 'trimestrielle' },
  { value: 'semiannual', label: 'Semestrielle', months: 6, adjective: 'semestrielle' },
  { value: 'annual', label: 'Annuelle', months: 12, adjective: 'annuelle' },
];

function info(frequency: Frequency) {
  return FREQUENCIES.find((f) => f.value === frequency) ?? FREQUENCIES[0];
}

/** Part mensuelle d'une dépense fixe, arrondie au centime. */
export function monthlyShare(amount: number, frequency: Frequency): number {
  return Math.round((amount / info(frequency).months) * 100) / 100;
}

/** Détail de la transaction copiée dans le mois. */
export function fixedExpenseDetail(amount: number, frequency: Frequency): string {
  if (frequency === 'monthly') return 'Prélèvement automatique';
  return `Part mensuelle d'une dépense ${info(frequency).adjective} de ${formatEUR(amount)}`;
}
