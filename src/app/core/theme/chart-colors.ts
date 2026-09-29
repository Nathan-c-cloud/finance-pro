/**
 * Couleurs des graphiques (Chart.js et anneau du mois). Chart.js dessine dans un
 * canvas et ne lit pas les variables CSS : ces valeurs doivent rester alignées avec
 * les variables --color-* de src/styles.scss.
 */
export const SEMANTIC_COLORS = {
  primary: '#245B63',
  income: '#177A55',
  expense: '#C43D3D',
  savings: '#B07A2E',
  neutral: '#8F8A7E',
} as const;

/**
 * Palette catégorielle, dans cet ordre fixe (jamais recyclée) : validée pour le
 * daltonisme et la distinction en vision normale sur fond blanc. L'or (4e couleur)
 * est sous 3:1 de contraste : toujours l'accompagner d'une légende ou d'un libellé.
 * Au-delà de 6 catégories, le reste passe en gris ("Autres").
 */
export const CATEGORY_COLORS = ['#0B90A6', '#D0603F', '#4470C4', '#CC9414', '#8A4F7D', '#2F9E6B'] as const;

export function categoryColor(index: number): string {
  return index < CATEGORY_COLORS.length ? CATEGORY_COLORS[index] : SEMANTIC_COLORS.neutral;
}
