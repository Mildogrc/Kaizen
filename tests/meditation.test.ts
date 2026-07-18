import { describe, expect, it } from 'vitest';
import { analyzeMeditation } from '../src/lib/meditation';

describe('meditation analytics', () => {
  it('counts unique practice days, streaks, and configured minutes', () => {
    const analytics = analyzeMeditation([
      { date: new Date('2026-07-14T12:00:00'), durationMin: 15 },
      { date: new Date('2026-07-15T12:00:00'), durationMin: null },
      { date: new Date('2026-07-16T12:00:00'), durationMin: 20 },
      { date: new Date('2026-07-16T18:00:00'), durationMin: 10 },
    ], 10, new Date('2026-07-17T12:00:00'));

    expect(analytics.totalDays).toBe(3);
    expect(analytics.totalMinutes).toBe(45);
    expect(analytics.currentStreak).toBe(3);
    expect(analytics.bestStreak).toBe(3);
    expect(analytics.daysLast30).toBe(3);
  });
});
