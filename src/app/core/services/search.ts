/** Minuscules et sans accents : "Électricité" et "electricite" se valent. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Recherche par nom : chaque mot saisi doit se retrouver dans le nom, dans n'importe quel ordre,
 * sans tenir compte des majuscules ni des accents ("super u" trouve "achat super u").
 * Une recherche vide laisse tout passer.
 */
export function matchesSearch(name: string, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const target = normalizeSearch(name);
  return words.every((w) => target.includes(w));
}
