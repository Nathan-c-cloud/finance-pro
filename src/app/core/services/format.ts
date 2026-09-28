export function formatEUR(value: number | null | undefined): string {
  const v = value ?? 0;
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

export function formatPercent(value: number | null | undefined): string {
  const v = value ?? 0;
  return (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
}
