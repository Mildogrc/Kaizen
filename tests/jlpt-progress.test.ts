import { describe, expect, it } from 'vitest';
import { currentJlptProgress } from '../src/lib/jlpt-progress';

describe('JLPT current goal', () => {
  const levels = [
    { name: 'N5', rank: 1, targetVocab: 800, grammarTotal: 40, grammarMastered: 0 },
    { name: 'N4', rank: 2, targetVocab: 1500, grammarTotal: 50, grammarMastered: 0 },
  ];

  it('keeps N5 active until both vocabulary and grammar are complete', () => {
    expect(currentJlptProgress(levels, 1277)).toMatchObject({ name: 'N5', wordsRemaining: 0, grammarRemaining: 40 });
  });

  it('advances only after both N5 requirements are complete', () => {
    expect(currentJlptProgress([{ ...levels[0], grammarMastered: 40 }, levels[1]], 1277)).toMatchObject({ name: 'N4', wordsRemaining: 223, grammarRemaining: 50 });
  });
});
