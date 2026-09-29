import { Frequency, TxType } from '../models/models';

/**
 * Format du classeur Excel d'échange (export et import). Tout ce qui définit le format vit ici,
 * pour que l'export et l'import ne puissent jamais diverger.
 *
 * Principes :
 * - L'import retrouve les colonnes par leur EN-TÊTE (pas par leur position) : on peut déplacer
 *   une colonne sans rien casser.
 * - Chaque ligne exportée porte un identifiant masqué (colonne "ID") : c'est ce qui permet à
 *   l'import de savoir quelle ligne modifier ou créer.
 * - Les colonnes "calculées" (formules) sont informatives : l'import les ignore, l'application
 *   recalcule tous les soldes elle-même.
 */
export const FORMAT_VERSION = 'Suivi Budget, classeur v1';

export const SHEET = {
  readme: 'Lisez-moi',
  settings: 'Réglages',
  categories: 'Catégories',
  fixed: 'Dépenses fixes',
  months: 'Mois',
  transactions: 'Transactions',
} as const;

/** Nombre maximal de lignes prises en compte par les formules et les listes déroulantes. */
export const MAX_ROWS = 5000;
/** Nombre de lignes de la feuille "Mois" qui contiennent déjà les formules de calcul (5 ans). */
export const MONTH_FORMULA_ROWS = 60;

export const H = {
  id: 'ID',
  // Réglages
  settingName: 'Réglage',
  settingValue: 'Valeur',
  initialBalance: 'Solde initial (€)',
  savingsCategory: "Catégorie d'épargne",
  // Catégories
  categoryName: 'Nom',
  // Dépenses fixes
  fixedName: 'Nom',
  fixedAmount: 'Montant de la période (€)',
  fixedCategory: 'Catégorie',
  fixedFrequency: 'Fréquence',
  fixedDay: 'Jour de prélèvement',
  fixedActive: 'Active',
  fixedShare: 'Part mensuelle (€)',
  // Mois
  monthKey: 'Mois (AAAA-MM)',
  monthStatus: 'Statut',
  monthOverride: 'Solde de départ forcé (€)',
  monthRealBalance: 'Solde réel constaté (€)',
  monthStart: 'Solde début (€)',
  monthIncome: 'Revenus (€)',
  monthExpenses: 'Dépenses hors épargne (€)',
  monthSavings: 'Épargne (€)',
  monthRate: "Taux d'épargne",
  monthChange: 'Évolution du compte (€)',
  monthEnd: 'Solde théorique fin de mois (€)',
  // Transactions
  txMonth: 'Mois (AAAA-MM)',
  txType: 'Type',
  txName: 'Nom',
  txAmount: 'Montant (€)',
  txCategory: 'Catégorie',
  txDate: 'Date',
  txDetail: 'Détail',
  txNecessary: 'Nécessaire ?',
  txReceived: 'Reçu ?',
} as const;

export const TYPE_LABELS: Record<TxType, string> = {
  income: 'Revenu',
  fixed: 'Dépense fixe',
  variable: 'Dépense variable',
};

export const STATUS_LABELS = { current: 'Courant', closed: 'Clôturé' } as const;

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: 'Mensuelle',
  bimonthly: 'Tous les 2 mois',
  quarterly: 'Trimestrielle',
  semiannual: 'Semestrielle',
  annual: 'Annuelle',
};

export const YES = 'Oui';
export const NO = 'Non';

/** Couleurs de l'application (src/styles.scss), en ARGB pour Excel. */
export const XL_COLORS = {
  primary: 'FF245B63',
  primaryHover: 'FF1B4A51',
  primarySoft: 'FFE3EEEF',
  primaryBorder: 'FFC8DDE0',
  sand: 'FFEFEBE0',
  surfaceMuted: 'FFF7F6F0',
  border: 'FFE1E5DF',
  text: 'FF17201C',
  textSecondary: 'FF68736D',
  income: 'FF177A55',
  incomeSoft: 'FFE5F2EC',
  savings: 'FFB07A2E',
  savingsSoft: 'FFFAF0DE',
  white: 'FFFFFFFF',
} as const;

// ------------------------------------------------------------------
// Utilitaires partagés export / import
// ------------------------------------------------------------------

/** Clé de comparaison de deux textes : sans majuscules, accents ni espaces autour. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** '2026-09-01' → '2026-09' */
export function monthKeyOf(monthDate: string): string {
  return monthDate.slice(0, 7);
}

/** Date 'AAAA-MM-JJ' → Date UTC à minuit (Excel stocke les dates sans fuseau). */
export function toExcelDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Nom de la feuille entre apostrophes pour une formule ('Dépenses fixes'!A1). */
export function q(sheet: string): string {
  return `'${sheet.replace(/'/g, "''")}'`;
}
