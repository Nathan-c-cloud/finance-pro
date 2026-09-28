export interface Category {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at?: string;
}

export type Frequency = 'monthly' | 'annual';

export interface FixedExpense {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  category_id: string | null;
  frequency: Frequency;
  payment_day: number;
  active: boolean;
  created_at?: string;
}

export type MonthStatus = 'current' | 'closed';

export interface MonthRow {
  id: string;
  user_id: string;
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
  remainingBeforeVariable: number; // "reste à vivre" = revenus - dépenses fixes hors épargne
  endingBalance: number;
  savingsRate: number; // 0..1
  byCategory: { categoryId: string | null; categoryName: string; amount: number }[];
}
