import { describe, expect, it } from 'vitest';
import { nestedDeckFallback } from '../src/lib/anki-deck';

describe('Anki deck resolution', () => {
  it('finds a uniquely nested deck when a mapped root deck is empty', () => {
    expect(nestedDeckFallback('RTK1 Kanji - Reversed Recognition', [
      'RTK1 Kanji - Reversed Recognition',
      'Japanese::RTK1 Kanji - Reversed Recognition',
    ])).toBe('Japanese::RTK1 Kanji - Reversed Recognition');
  });

  it('does not guess when multiple nested decks have the same suffix', () => {
    expect(nestedDeckFallback('AnimeDeck', [
      'Japanese::AnimeDeck',
      'Archive::AnimeDeck',
    ])).toBeNull();
  });
});
