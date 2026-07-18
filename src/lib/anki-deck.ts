export function nestedDeckFallback(mappedDeckName: string, availableDeckNames: string[]): string | null {
  const suffix = `::${mappedDeckName}`;
  const matches = availableDeckNames.filter((deckName) => deckName.endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
}
