import { CATEGORY_COLORS, SEMANTIC_COLORS } from '../theme/chart-colors';

export interface BreakdownInput {
  categoryId: string | null;
  categoryName: string;
  amount: number;
}

export interface BreakdownSlice {
  id: string;
  name: string;
  amount: number;
  color: string;
  /** Renseigné uniquement pour la part "Petites catégories" : les catégories qu'elle regroupe. */
  grouped?: BreakdownInput[];
}

export const OTHERS_LABEL = 'Petites catégories';

/**
 * Répartition d'un mois par catégorie, partagée par la page Mois et le Dashboard.
 *
 * Les 6 plus grosses catégories du mois prennent les couleurs de la palette, dans l'ordre
 * (la plus grosse en premier). Le reste est regroupé en une seule part grise "Petites catégories",
 * sauf s'il n'en reste qu'une : elle garde alors son nom. Au delà de 6 couleurs, on ne peut plus
 * distinguer les parts à l'oeil : mieux vaut un regroupement lisible que 13 teintes proches.
 *
 * - slices : les parts de l'anneau (montants positifs uniquement)
 * - legend : toutes les lignes non nulles, de la plus grosse à la plus petite ; les catégories
 *   regroupées gardent leur ligne, avec un point gris
 */
export function buildBreakdown(byCategory: BreakdownInput[]) {
  const positives = byCategory.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount);
  const top = positives.slice(0, CATEGORY_COLORS.length);
  const rest = positives.slice(CATEGORY_COLORS.length);

  const slices: BreakdownSlice[] = top.map((b, i) => ({
    id: String(b.categoryId),
    name: b.categoryName,
    amount: b.amount,
    color: CATEGORY_COLORS[i],
  }));

  if (rest.length === 1) {
    const b = rest[0];
    slices.push({ id: String(b.categoryId), name: b.categoryName, amount: b.amount, color: SEMANTIC_COLORS.neutral });
  } else if (rest.length > 1) {
    slices.push({
      id: '__others__',
      name: OTHERS_LABEL,
      amount: rest.reduce((sum, b) => sum + b.amount, 0),
      color: SEMANTIC_COLORS.neutral,
      grouped: rest,
    });
  }

  const colorOf = new Map<string, string>();
  top.forEach((b, i) => colorOf.set(String(b.categoryId), CATEGORY_COLORS[i]));

  const legend = byCategory
    .filter((b) => b.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
    .map((b) => ({
      id: String(b.categoryId),
      name: b.categoryName,
      amount: b.amount,
      color: colorOf.get(String(b.categoryId)) ?? SEMANTIC_COLORS.neutral,
    }));

  return { slices, legend };
}
