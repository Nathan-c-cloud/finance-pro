export function formatEUR(value: number | null | undefined): string {
  const v = value ?? 0;
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

/** Pourcentage à partir d'une fraction (0.095 → "9,5 %"). Valeur absente : tiret long, jamais "0 %". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const v = value;
  return (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
}
