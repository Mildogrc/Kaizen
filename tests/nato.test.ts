import { describe, expect, it } from 'vitest';
import { analyzeNatoSessions, natoIntervalDays, selectNatoWord, weekendSkills } from '../src/lib/nato';

describe('NATO scheduling', () => {
  it('uses weekly, biweekly, and monthly intervals from recall quality', () => {
    expect(natoIntervalDays({ accuracy: 0.8, averageRecallMs: 1_000 })).toBe(7);
    expect(natoIntervalDays({ accuracy: 1, averageRecallMs: 2_000 })).toBe(14);
    expect(natoIntervalDays({ accuracy: 1, averageRecallMs: 1_000 })).toBe(28);
  });

  it('schedules NATO only on Saturday', () => {
    const saturday = new Date('2026-07-18T12:00:00');
    const sunday = new Date('2026-07-19T12:00:00');
    expect(weekendSkills(saturday, null).map((skill) => skill.key)).toEqual(['geoguessr', 'nato']);
    expect(weekendSkills(sunday, null)).toEqual([]);
    expect(weekendSkills(sunday, new Date('2026-07-26T12:00:00')).map((skill) => skill.key)).toEqual(['typing']);
  });

  it('tracks per-letter recall and selects a training word', () => {
    const analytics = analyzeNatoSessions([{ date: new Date('2026-07-01'), stats: { word: 'BOX', attempts: [{ letter: 'B', typed: 'Bravo', correct: true, timeMs: 900 }, { letter: 'O', typed: 'Oscar', correct: true, timeMs: 1_100 }, { letter: 'X', typed: 'xray', correct: false, timeMs: 4_000 }] } }]);
    expect(analytics.metrics.find((metric) => metric.letter === 'X')?.accuracy).toBe(0);
    expect(selectNatoWord(analytics.metrics, 1)).toMatch(/^[A-Z]+$/);
  });
});
