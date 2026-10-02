/** Dates de l'application : stockées en ISO (aaaa-mm-jj), affichées et saisies en jj/mm/aaaa. */

/** '2026-10-05' devient '05/10/2026'. */
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Nombre de jours d'un mois (month de 1 à 12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** '05/10/2026' devient '2026-10-05', ou null si ce n'est pas une vraie date (31/02/2026, 5/10/26...). */
export function parseDateFr(text: string): string | null {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Compare deux dates ISO du plus ancien au plus récent ; une transaction sans date passe toujours après les autres. */
export function compareIsoDatesNullLast(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}
