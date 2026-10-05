import { describe, expect, it } from 'vitest';
import { analyzeGrammarLearning } from '../src/lib/grammar-analytics';

describe('grammar learning analytics', () => {
  it('recalculates totals, ratings, due counts, and weekly progress', () => {
    const analytics = analyzeGrammarLearning([
      { status: 'MASTERED', dueAt: new Date('2026-08-20T12:00:00'), totalCorrect: 3, totalQuestions: 3 },
      { status: 'REVIEW', dueAt: new Date('2026-07-24T12:00:00'), totalCorrect: 1, totalQuestions: 2 },
      { status: 'NEW', dueAt: new Date('2026-07-01T12:00:00'), totalCorrect: 0, totalQuestions: 0 },
    ], [
      {
        completedAt: new Date('2026-07-24T12:00:00'),
        response: { grammarResults: [{ rating: 'GOOD' }, { rating: 'HARD' }] },
      },
      {
        completedAt: new Date('2026-07-25T12:00:00'),
        response: { grammarResults: [{ rating: 'EASY' }] },
      },
      { completedAt: new Date('2026-07-23T12:00:00'), response: null },
    ], 2, new Date('2026-07-25T20:00:00'));

    expect(analytics.completedLessons).toBe(2);
    expect(analytics.lessonsToday).toBe(1);
    expect(analytics.totalCorrect).toBe(4);
    expect(analytics.totalQuestions).toBe(5);
    expect(analytics.accuracy).toBe(0.8);
    expect(analytics.mastered).toBe(1);
    expect(analytics.due).toBe(1);
    expect(analytics.currentStreak).toBe(2);
    expect(analytics.importedPassages).toBe(2);
    expect(analytics.ratingDistribution.map((row) => row.value)).toEqual([0, 1, 1, 1]);
    expect(analytics.ratingDistribution.map((row) => row.label)).toEqual(['Again', 'Hard (legacy)', 'Good', 'Perfect']);
    expect(analytics.weeklyProgress.at(-1)?.value).toBe(3);
  });
});
