import { Category, MonthRow, Transaction } from '../models/models';
import { budgetSpent, normalize, sum } from './calc';
import { formatEUR } from './format';

/**
 * Statistiques par catégorie et suggestions de budget. Tout est calculé à la volée, en fonctions pures,
 * avec des règles simples et vérifiables (médiane, seuils). Aucune IA : chaque suggestion affiche les chiffres qui la justifient.
 */

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(nums: number[]): number {
  return nums.length === 0 ? 0 : sum(nums) / nums.length;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Arrondi au multiple de 5 € supérieur : un budget lisible plutôt que 212,40 €. */
export function roundUp5(n: number): number {
  return Math.ceil(n / 5 - 1e-9) * 5 || 0; // || 0 évite -0
}

export function isSavings(c: Category): boolean {
  return normalize(c.name) === 'epargne';
}

/** Mois terminés : ceux d'avant le mois en cours du calendrier (le mois qui se déroule n'est pas comparable). Du plus ancien au plus récent. */
export function completeMonths(months: MonthRow[], today: Date = new Date()): MonthRow[] {
  const firstOfThisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  return [...months].filter((m) => m.month_date < firstOfThisMonth).sort((a, b) => a.month_date.localeCompare(b.month_date));
}

/** Le budget d'une catégorie compte-t-il ses dépenses fixes ? Sans budget, tout compte. */
function includesFixed(c: Category): boolean {
  return c.budget_default === null || c.budget_default === undefined ? true : c.budget_include_fixed !== false;
}

export interface CategoryStat {
  category: Category;
  /** Dépensé par mois, dans l'ordre des mois fournis. */
  amounts: number[];
  median: number;
  average: number;
  max: number;
  /** Budget par défaut actuel, ou null. */
  budget: number | null;
  /** Mois (parmi ceux fournis) où la dépense dépasse le budget par défaut actuel. */
  overCount: number;
}

/** Dépensé par catégorie sur les mois donnés. Épargne exclue ; les catégories sans aucune dépense ni budget sont omises. */
export function categoryStats(months: MonthRow[], transactions: Transaction[], categories: Category[]): CategoryStat[] {
  const byMonth = new Map<string, Transaction[]>();
  for (const t of transactions) byMonth.set(t.month_id, [...(byMonth.get(t.month_id) ?? []), t]);

  return categories
    .filter((c) => !isSavings(c))
    .map((c) => {
      const amounts = months.map((m) => budgetSpent(byMonth.get(m.id) ?? [], c.id, includesFixed(c)));
      const budget = c.budget_default ?? null;
      return {
        category: c,
        amounts,
        median: round2(median(amounts)),
        average: round2(average(amounts)),
        max: amounts.length ? Math.max(...amounts) : 0,
        budget,
        overCount: budget === null ? 0 : amounts.filter((a) => a > budget + 0.005).length,
      };
    })
    .filter((s) => s.amounts.some((a) => a > 0) || (s.budget !== null && !s.category.archived))
    .sort((a, b) => b.median - a.median || a.category.name.localeCompare(b.category.name, 'fr'));
}

export type SuggestionKind = 'raise' | 'lower' | 'create';

export interface BudgetSuggestion {
  categoryId: string;
  categoryName: string;
  kind: SuggestionKind;
  /** Budget par défaut actuel (null s'il n'y en a pas). */
  current: number | null;
  suggested: number;
  /** Les faits qui justifient la suggestion, en une phrase. */
  facts: string;
  /** Dernier mois terminé pris en compte (AAAA-MM) : sert à mémoriser « Garder mon budget » jusqu'au mois suivant. */
  basedOn: string;
}

export interface SuggestionResult {
  suggestions: BudgetSuggestion[];
  /** Faux s'il y a moins de 3 mois terminés avec des transactions : on ne suggère rien. */
  enoughHistory: boolean;
  months: MonthRow[];
  /** Parmi les mois pris en compte, combien contiennent au moins une transaction. */
  withData: number;
}

/** Les 3 derniers mois terminés, ils doivent tous contenir des transactions. */
export const SUGGESTION_WINDOW = 3;

/**
 * Règles (sur les 3 derniers mois terminés). Une catégorie n'est regardée que si sa dépense médiane sur ces 3 mois est d'au moins 50 € :
 * en dessous, ce sont de petites sommes et un budget n'aurait pas de sens. La médiane évite qu'un seul mois exceptionnel décide.
 * - budget dépassé au moins 2 mois sur 3 : proposer de le relever à la médiane ;
 * - dépense restée sous 80 % du budget les 3 mois : proposer de le baisser au mois le plus élevé (arrondi), qui couvre encore les 3 mois ;
 * - pas de budget : proposer la médiane comme budget.
 * Les montants sont arrondis au multiple de 5 € supérieur. Les catégories archivées et l'épargne sont ignorées.
 */
export const SUGGESTION_MIN_MONTHLY = 50;

export function suggestBudgets(
  months: MonthRow[],
  transactions: Transaction[],
  categories: Category[],
  today: Date = new Date()
): SuggestionResult {
  const window = completeMonths(months, today).slice(-SUGGESTION_WINDOW);
  const hasData = (m: MonthRow) => transactions.some((t) => t.month_id === m.id);
  if (window.length < SUGGESTION_WINDOW || !window.every(hasData)) {
    return { suggestions: [], enoughHistory: false, months: window, withData: window.filter(hasData).length };
  }

  const basedOn = window[window.length - 1].month_date.slice(0, 7);
  const stats = categoryStats(window, transactions, categories).filter(
    (s) => !s.category.archived && s.median >= SUGGESTION_MIN_MONTHLY
  );

  const suggestions: BudgetSuggestion[] = [];
  for (const s of stats) {
    const base = { categoryId: s.category.id, categoryName: s.category.name, current: s.budget, basedOn };
    const suggested = roundUp5(s.median);
    if (s.budget !== null) {
      if (s.overCount >= 2 && suggested > s.budget) {
        suggestions.push({
          ...base,
          kind: 'raise',
          suggested,
          facts: `Au dessus du budget ${s.overCount} mois sur ${window.length} (médiane ${formatEUR(s.median)}, budget ${formatEUR(s.budget)}).`,
        });
      } else if (s.budget > 0 && s.amounts.every((a) => a <= s.budget! * 0.8 + 0.005)) {
        // Pour baisser, on garde de la marge : le plus haut des 3 mois, arrondi, couvre encore chacun d'eux.
        const lower = roundUp5(s.max);
        if (lower < s.budget) {
          suggestions.push({
            ...base,
            kind: 'lower',
            suggested: lower,
            facts: `Sous 80 % du budget les ${window.length} derniers mois (au plus ${formatEUR(s.max)}, budget ${formatEUR(s.budget)}).`,
          });
        }
      }
    } else {
      suggestions.push({
        ...base,
        kind: 'create',
        suggested,
        facts: `Médiane de ${formatEUR(s.median)} par mois sur ${window.length} mois, sans budget.`,
      });
    }
  }
  return { suggestions, enoughHistory: true, months: window, withData: window.length };
}
