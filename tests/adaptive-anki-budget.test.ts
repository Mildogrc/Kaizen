import { describe, expect, it } from 'vitest';
import {
  allocateAdaptiveBudget,
  adaptiveApplicationIsClaimable,
  adaptiveResetState,
  ankiDayKey,
  calculateAdaptiveBudget,
  summarizeAdaptiveEvidenceDay,
  type AdaptiveEvidenceDay,
} from '../src/lib/adaptive-anki-budget';

const SETTINGS = {
  startingBudget: 10,
  maximumBudget: 40,
  coldStartProtection: true,
  targetReviewMinutes: 60,
};

function day(index: number, overrides: Partial<AdaptiveEvidenceDay> = {}): AdaptiveEvidenceDay {
  const reviewedCardIds = Array.from({ length: 25 }, (_, card) => `card-${index}-${card}`);
  return {
    ankiDay: `2026-09-${String(index + 1).padStart(2, '0')}`,
    reviewObservations: 25,
    reviewedCardCount: 25,
    reviewedCardIds,
    lapsedCardIds: [],
    reviewMinutes: 20,
    validTimeObservations: 25,
    reviewsDue: 25,
    reviewsCompleted: 25,
    completionRate: 1,
    retention: 0.96,
    reliable: true,
    dataAvailable: true,
    ...overrides,
  };
}

describe('adaptive Anki evidence', () => {
  it('uses Anki day boundaries and excludes the activation day', () => {
    expect(ankiDayKey(new Date(2026, 8, 23, 3, 59), 4)).toBe('2026-09-22');
    expect(ankiDayKey(new Date(2026, 8, 23, 4, 0), 4)).toBe('2026-09-23');
    const logs = Array.from({ length: 20 }, (_, index) => ({
      ankiCardId: String(index), reviewedAt: new Date(2026, 8, 23, 5, index),
      rating: 3, timeMs: 2_000, reviewType: 1,
    }));
    const evidence = summarizeAdaptiveEvidenceDay({
      day: '2026-09-23', dayStartHour: 4, activationDay: '2026-09-23',
      logs, reviewsDue: 20, dataAvailable: true, currentDay: '2026-09-24',
    });
    expect(evidence).toMatchObject({ reviewObservations: 20, reliable: false, retention: 1 });
  });

  it('uses only the first review-card attempt for true retention', () => {
    const logs = Array.from({ length: 20 }, (_, index) => ([
      { ankiCardId: String(index), reviewedAt: new Date(2026, 8, 22, 5, index), rating: index === 0 ? 1 : 3, timeMs: 2_000, reviewType: 1 },
      { ankiCardId: String(index), reviewedAt: new Date(2026, 8, 22, 6, index), rating: 3, timeMs: 2_000, reviewType: 2 },
    ])).flat();
    const evidence = summarizeAdaptiveEvidenceDay({
      day: '2026-09-22', dayStartHour: 4, activationDay: '2026-09-21',
      logs, reviewsDue: 20, dataAvailable: true, currentDay: '2026-09-23',
    });
    expect(evidence.retention).toBe(0.95);
    expect(evidence.reliable).toBe(true);
  });
});

describe('adaptive Anki controller', () => {
  it('starts conservatively and ramps the confidence ceiling after seven reliable days', () => {
    const first = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 0, evidence: [], overdueCount: 0, settings: SETTINGS });
    expect(first.finalBudget).toBe(10);
    const ramped = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 7, evidence: Array.from({ length: 7 }, (_, index) => day(index)), overdueCount: 0, settings: SETTINGS });
    expect(ramped.confidenceCeiling).toBe(12);
    expect(ramped.finalBudget).toBe(12);
  });

  it('lets poor performance reduce the budget without waiting for confidence', () => {
    const evidence = Array.from({ length: 3 }, (_, index) => day(index, { retention: 0.75, reviewMinutes: 100 }));
    const result = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 3, evidence, overdueCount: 0, settings: SETTINGS });
    expect(result.performanceTarget).toBe(0);
    expect(result.finalBudget).toBe(0);
  });

  it('blocks increases without enough completion evidence', () => {
    const result = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 7, evidence: [day(1), day(2)], overdueCount: 0, settings: SETTINGS });
    expect(result.finalBudget).toBe(10);
    expect(result.reasons.join(' ')).toContain('Increase blocked');
  });

  it('pauses new cards for a serious backlog', () => {
    const evidence = Array.from({ length: 7 }, (_, index) => day(index));
    const result = calculateAdaptiveBudget({ previousBudget: 12, reliableDataDays: 7, evidence, overdueCount: 50, settings: SETTINGS });
    expect(result.finalBudget).toBe(0);
  });

  it('does not let missing data increase confidence or workload', () => {
    const result = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 0, evidence: [day(1, { reliable: false, dataAvailable: false })], overdueCount: 0, settings: SETTINGS });
    expect(result).toMatchObject({ reliableWindowDays: 0, finalBudget: 10, confidenceCeiling: 10 });
  });

  it('respects the configured maximum and zero-card minimum', () => {
    const excellent = calculateAdaptiveBudget({
      previousBudget: 39,
      reliableDataDays: 100,
      evidence: Array.from({ length: 7 }, (_, index) => day(index)),
      overdueCount: 0,
      settings: { ...SETTINGS, coldStartProtection: false },
    });
    expect(excellent.finalBudget).toBe(40);
    const poor = calculateAdaptiveBudget({
      previousBudget: 2,
      reliableDataDays: 100,
      evidence: Array.from({ length: 7 }, (_, index) => day(index, { retention: 0.5, reviewMinutes: 200 })),
      overdueCount: 0,
      settings: SETTINGS,
    });
    expect(poor.finalBudget).toBe(0);
  });

  it('blocks increases when scheduled reviews were skipped', () => {
    const evidence = Array.from({ length: 7 }, (_, index) => day(index, { reviewsDue: 25, reviewsCompleted: 20, completionRate: 0.8 }));
    const result = calculateAdaptiveBudget({ previousBudget: 10, reliableDataDays: 7, evidence, overdueCount: 0, settings: SETTINGS });
    expect(result.finalBudget).toBe(10);
    expect(result.completionRate).toBe(0.8);
  });

  it('restarts at cold start and prevents duplicate same-day application claims', () => {
    const now = new Date('2026-09-23T12:00:00-04:00');
    expect(adaptiveResetState(SETTINGS, now)).toEqual({ activatedAt: now, currentBudget: 10, reliableDataDays: 0 });
    expect(adaptiveApplicationIsClaimable('pending', null, now)).toBe(true);
    expect(adaptiveApplicationIsClaimable('applied', now, now)).toBe(false);
    expect(adaptiveApplicationIsClaimable('applying', now, now)).toBe(false);
    expect(adaptiveApplicationIsClaimable('applying', new Date(now.getTime() - 6 * 60_000), now)).toBe(true);
  });
});

describe('adaptive budget allocation', () => {
  it('allocates proportionally and never exceeds deck capacity', () => {
    expect(allocateAdaptiveBudget(10, [
      { mappingId: 'a', deckName: 'A', availableNew: 20 },
      { mappingId: 'b', deckName: 'B', availableNew: 5 },
    ])).toEqual([
      { mappingId: 'a', deckName: 'A', availableNew: 20, budget: 8 },
      { mappingId: 'b', deckName: 'B', availableNew: 5, budget: 2 },
    ]);
    expect(allocateAdaptiveBudget(40, [{ mappingId: 'a', deckName: 'A', availableNew: 3 }])[0].budget).toBe(3);
  });
});
