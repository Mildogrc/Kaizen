import { describe, expect, it } from 'vitest';
import { crossedWordMilestoneIndexes, hasCompletedActiveVocabGoal, levelBandProgressPercent } from '../src/lib/progression';

describe('word progression', () => {
  it('crosses every pending milestone at or below the lower bound', () => {
    const completed = new Date('2026-01-01T00:00:00Z');
    expect(
      crossedWordMilestoneIndexes(
        [
          { targetValue: 100, completedAt: completed },
          { targetValue: 500, completedAt: null },
          { targetValue: 800, completedAt: null },
          { targetValue: 1500, completedAt: null },
          { targetValue: null, completedAt: null },
        ],
        1277,
      ),
    ).toEqual([1, 2]);
  });

  it('detects when the active vocabulary goal should complete', () => {
    expect(
      hasCompletedActiveVocabGoal(
        [{ targetValue: 500, status: 'ACTIVE' }],
        1277,
      ),
    ).toBe(true);
    expect(
      hasCompletedActiveVocabGoal(
        [{ targetValue: 1500, status: 'ACTIVE' }],
        1277,
      ),
    ).toBe(false);
  });

  it('measures progress inside one non-cumulative level band', () => {
    expect(levelBandProgressPercent(1277, 800)).toBe(100);
    expect(levelBandProgressPercent(1277, 1500, 800)).toBeCloseTo(68.14, 2);
    expect(levelBandProgressPercent(1277, 3750, 1500)).toBe(0);
    expect(levelBandProgressPercent(438, 440, 240)).toBe(99);
  });
});
