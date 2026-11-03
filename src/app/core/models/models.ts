export interface Category {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  /** Catégorie archivée : masquée quand on ajoute une opération, mais conservée dans l'historique. */
  archived?: boolean;
  /** Budget mensuel par défaut, copié dans chaque nouveau mois ; null ou absent = pas de budget. */
  budget_default?: number | null;
  /** Faux : le budget ne suit que les dépenses variables (les dépenses fixes de la catégorie ne comptent pas). */
  budget_include_fixed?: boolean;
  created_at?: string;
}

/** Budget d'une catégorie pour un mois précis (copie figée du budget par défaut, modifiable). */
export interface MonthBudget {
  id: string;
  user_id: string;
  month_id: string;
  category_id: string;
  amount: number;
  include_fixed: boolean;
  created_at?: string;
}

/** Type d'un compte : une étiquette que l'utilisateur choisit (et peut changer), pas une règle de la banque. */
export type AccountKind = 'checking' | 'savings';

export type AccountStatus = 'active' | 'closed';

/** Un compte bancaire. Chaque compte a sa propre chronologie de mois et ses dépenses fixes. Il ne se supprime pas : il se clôture. */
export interface Account {
  id: string;
  user_id: string;
  name: string;
  kind: AccountKind;
  /** Solde de départ du suivi de ce compte (sans origine : on part de ce solde et on avance). */
  opening_balance: number;
  /** Information : mois de départ du suivi ('YYYY-MM-01'). */
  opening_date: string | null;
  status: AccountStatus;
  /** Date de clôture ('YYYY-MM-DD'), renseignée si et seulement si le compte est clôturé. */
  closed_at: string | null;
  created_at?: string;
}

export type Frequency = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual';

export interface FixedExpense {
  id: string;
  user_id: string;
  /** Compte auquel appartient cette dépense fixe (rattachée automatiquement au premier compte actif si absent à la création). */
  account_id?: string;
  name: string;
  amount: number;
  category_id: string | null;
  frequency: Frequency;
  /** Jour du mois (1 à 31) où la dépense est prélevée ; null = pas de date (transaction ajoutée sans date). */
  payment_day: number | null;
  active: boolean;
  created_at?: string;
}

export type MonthStatus = 'current' | 'closed';

export interface MonthRow {
  id: string;
  user_id: string;
  /** Compte auquel appartient ce mois (rattaché automatiquement au premier compte actif si absent à la création). */
  account_id?: string;
  month_date: string; // 'YYYY-MM-01'
  status: MonthStatus;
  starting_balance_override: number | null;
  real_balance_check: number | null;
  created_at?: string;
}

export type TxType = 'fixed' | 'variable' | 'income';

export interface Transaction {
  id: string;
  user_id: string;
  month_id: string;
  type: TxType;
  name: string;
  amount: number;
  category_id: string | null;
  tx_date: string | null; // 'YYYY-MM-DD'
  detail: string | null;
  necessary: boolean | null;
  received: boolean | null;
  created_at?: string;
}

export interface UserSettings {
  user_id: string;
  initial_balance: number;
  updated_at?: string;
}

/** Résumé calculé d'un mois : jamais stocké tel quel, toujours dérivé. */
export interface MonthSummary {
  month: MonthRow;
  startingBalance: number;
  income: number;
  expensesExcludingSavings: number;
  savings: number;
  accountChange: number; // "évolution du compte" = solde fin moins solde début
  /** Solde de fin affiché : la valeur forcée si le mois suivant a recalé le solde, sinon le solde calculé. */
  endingBalance: number;
  /** Solde de fin calculé à partir des transactions, sans forçage. */
  computedEndingBalance: number;
  /** Vrai si le solde de fin a été forcé (recalage depuis le mois suivant). */
  endingForced: boolean;
  /** Épargne / revenus (0..1), ou null quand il n'a pas de sens : pas de revenus, ou épargne supérieure aux revenus. */
  savingsRate: number | null;
  /** Dépenses par catégorie, hors catégorie Épargne (comme "Dépenses (hors épargne)"). */
  byCategory: { categoryId: string | null; categoryName: string; amount: number }[];
}
