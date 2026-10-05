import { describe, expect, it } from 'vitest';
import { cumulativeJlptLevels, currentJlptProgress } from '../src/lib/jlpt-progress';

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

  it('counts lower-level grammar toward every higher JLPT level', () => {
    expect(cumulativeJlptLevels([
      { ...levels[0], grammarMastered: 20 },
      levels[1],
      { name: 'N3', rank: 3, targetVocab: 3750, grammarTotal: 60, grammarMastered: 0 },
    ])).toEqual([
      { ...levels[0], grammarMastered: 20 },
      { ...levels[1], grammarTotal: 90, grammarMastered: 20 },
      { name: 'N3', rank: 3, targetVocab: 3750, grammarTotal: 150, grammarMastered: 20 },
    ]);
  });
});
