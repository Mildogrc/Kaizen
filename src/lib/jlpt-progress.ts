export interface JlptLevelState {
  name: string;
  rank: number;
  targetVocab: number;
  grammarTotal: number;
  grammarMastered: number;
}

export interface CurrentJlptProgress extends JlptLevelState {
  wordsRemaining: number;
  grammarRemaining: number;
  wordProgress: number;
  grammarProgress: number;
}

export function cumulativeJlptLevels(levels: JlptLevelState[]): JlptLevelState[] {
  let grammarTotal = 0;
  let grammarMastered = 0;

  return [...levels]
    .sort((left, right) => left.rank - right.rank)
    .map((level) => {
      grammarTotal += level.grammarTotal;
      grammarMastered += level.grammarMastered;
      return { ...level, grammarTotal, grammarMastered };
    });
}

export function currentJlptProgress(levels: JlptLevelState[], knownWords: number): CurrentJlptProgress | null {
  const ordered = [...levels].sort((left, right) => left.rank - right.rank);
  for (const level of ordered) {
    const wordsRemaining = Math.max(0, level.targetVocab - knownWords);
    const grammarRemaining = Math.max(0, level.grammarTotal - level.grammarMastered);
    if (wordsRemaining === 0 && grammarRemaining === 0) continue;
    const wordProgress = level.targetVocab > 0 ? Math.min(100, (knownWords / level.targetVocab) * 100) : 0;
    const grammarProgress = level.grammarTotal > 0 ? Math.min(100, (level.grammarMastered / level.grammarTotal) * 100) : 0;
    return {
      ...level,
      wordsRemaining,
      grammarRemaining,
      wordProgress,
      grammarProgress,
    };
  }
  return null;
}
