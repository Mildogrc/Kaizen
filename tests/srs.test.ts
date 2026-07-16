import { describe, expect, it } from 'vitest';
import { rate, type SrsState } from '../src/lib/srs';

const NOW = new Date('2026-07-16T12:00:00Z');

const newCard: SrsState = { ease: 2.5, intervalDays: 0, repetitions: 0, lapseCount: 0, isLeech: false };
const reviewCard: SrsState = { ease: 2.5, intervalDays: 10, repetitions: 5, lapseCount: 0, isLeech: false };

const minutesFromNow = (d: Date) => Math.round((d.getTime() - NOW.getTime()) / 60_000);
const daysFromNow = (d: Date) => Math.round((d.getTime() - NOW.getTime()) / 86_400_000);

describe('SM-2 scheduler', () => {
  it('new card GOOD goes through a learning step, then graduates to 1 day', () => {
    const step1 = rate(newCard, 'GOOD', NOW);
    expect(step1.maturity).toBe('LEARNING');
    expect(minutesFromNow(step1.dueAt)).toBe(10);

    const step2 = rate(step1, 'GOOD', NOW);
    expect(step2.intervalDays).toBe(1);
    expect(step2.maturity).toBe('YOUNG');
    expect(daysFromNow(step2.dueAt)).toBe(1);
  });

  it('new card EASY graduates immediately at 4 days with an ease bonus', () => {
    const result = rate(newCard, 'EASY', NOW);
    expect(result.intervalDays).toBe(4);
    expect(result.ease).toBeCloseTo(2.65);
  });

  it('review card GOOD multiplies interval by ease', () => {
    const result = rate(reviewCard, 'GOOD', NOW);
    expect(result.intervalDays).toBe(25); // 10 * 2.5
    expect(result.maturity).toBe('MATURE');
    expect(daysFromNow(result.dueAt)).toBe(25);
  });

  it('review card HARD grows slowly and drops ease', () => {
    const result = rate(reviewCard, 'HARD', NOW);
    expect(result.intervalDays).toBe(12); // 10 * 1.2
    expect(result.ease).toBeCloseTo(2.35);
    expect(result.maturity).toBe('YOUNG');
  });

  it('review card AGAIN lapses back to learning and reduces ease', () => {
    const result = rate(reviewCard, 'AGAIN', NOW);
    expect(result.lapseCount).toBe(1);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(0);
    expect(result.ease).toBeCloseTo(2.3);
    expect(result.maturity).toBe('LEARNING');
    expect(minutesFromNow(result.dueAt)).toBe(10);
  });

  it('learning-step AGAIN does not count as a lapse', () => {
    const result = rate(newCard, 'AGAIN', NOW);
    expect(result.lapseCount).toBe(0);
  });

  it('ease never drops below 1.3', () => {
    let s: SrsState = { ...reviewCard, ease: 1.35 };
    s = rate(s, 'AGAIN', NOW);
    expect(s.ease).toBe(1.3);
    s = rate({ ...s, intervalDays: 5 }, 'HARD', NOW);
    expect(s.ease).toBe(1.3);
  });

  it('interval always grows on GOOD even at minimum ease', () => {
    const result = rate({ ...reviewCard, ease: 1.3, intervalDays: 2 }, 'GOOD', NOW);
    expect(result.intervalDays).toBeGreaterThan(2);
  });

  it('8 lapses marks the card as a leech', () => {
    let s: SrsState = { ...reviewCard, lapseCount: 7 };
    s = rate(s, 'AGAIN', NOW);
    expect(s.lapseCount).toBe(8);
    expect(s.isLeech).toBe(true);
  });

  it('honors imported Anki ease and long intervals', () => {
    // A mature imported card: 659-day interval, 2.65 ease (factor 2650).
    const imported: SrsState = { ease: 2.65, intervalDays: 659, repetitions: 5, lapseCount: 0, isLeech: false };
    const result = rate(imported, 'GOOD', NOW);
    expect(result.intervalDays).toBe(Math.round(659 * 2.65));
    expect(result.maturity).toBe('MATURE');
  });
});
