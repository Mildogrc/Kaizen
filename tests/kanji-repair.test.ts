import { describe, expect, it } from 'vitest';
import type { LogRow } from '../src/lib/anki-analytics';
import type { RtkKanjiEntry } from '../src/lib/kanji-extract';
import {
  scoreKanjiRepairCandidates,
  selectKanjiRepairTarget,
  type KanjiRepairEvidenceCard,
  type KanjiRepairStateEvidence,
} from '../src/lib/kanji-repair';

const NOW = new Date('2026-09-23T12:00:00-04:00');

function entry(kanji: string, rtkNumber: number): RtkKanjiEntry {
  return { kanji, keyword: `keyword-${kanji}`, rtkNumber, book: 1, lesson: 1, metadata: {} };
}

function log(rating: number, daysAgo: number, cardId: string): LogRow {
  return {
    ankiCardId: cardId,
    reviewedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    rating,
    intervalBeforeDays: 10,
    intervalAfterDays: rating === 1 ? 1 : 20,
    timeMs: rating <= 2 ? 11_000 : 3_000,
  };
}

function card(
  kanji: string[],
  ratings: Array<{ rating: number; daysAgo: number }>,
  id = `card-${kanji.join('')}`,
): KanjiRepairEvidenceCard {
  return {
    ankiCardId: id,
    label: kanji.join(''),
    kanji,
    intervalDays: 30,
    ease: 2.3,
    lapses: ratings.filter((rating) => rating.rating === 1).length,
    logs: ratings.map((rating) => log(rating.rating, rating.daysAgo, id)),
  };
}

function state(kanji: string, lastRepairedAt: Date, cooldownUntil: Date): KanjiRepairStateEvidence {
  return { kanji, lastRepairedAt, cooldownUntil, repairCount: 1, lastRepairScore: 0.5 };
}

describe('Kanji Repair scoring', () => {
  it('weights recent failures above old failures', () => {
    const oldFailures = [100, 90, 80, 70].map((daysAgo) => ({ rating: 1, daysAgo }));
    const recentGoods = [4, 3, 2, 1].map((daysAgo) => ({ rating: 3, daysAgo }));
    const oldGoods = [100, 90, 80, 70].map((daysAgo) => ({ rating: 3, daysAgo }));
    const recentFailures = [4, 3, 2, 1].map((daysAgo) => ({ rating: 1, daysAgo }));
    const candidates = scoreKanjiRepairCandidates({
      entries: [entry('古', 1), entry('新', 2)],
      directCards: [card(['古'], [...oldFailures, ...recentGoods]), card(['新'], [...oldGoods, ...recentFailures])],
      vocabularyCards: [], repairStates: [], useVocabularyPerformance: false, now: NOW,
    });
    expect(candidates.find((candidate) => candidate.entry.kanji === '新')!.score)
      .toBeGreaterThan(candidates.find((candidate) => candidate.entry.kanji === '古')!.score);
  });

  it('does not allow tiny samples to become eligible', () => {
    const candidates = scoreKanjiRepairCandidates({
      entries: [entry('少', 1), entry('多', 2)],
      directCards: [
        card(['少'], [{ rating: 1, daysAgo: 2 }, { rating: 3, daysAgo: 1 }]),
        card(['多'], Array.from({ length: 40 }, (_, index) => ({ rating: index < 10 ? 1 : 3, daysAgo: 40 - index }))),
      ],
      vocabularyCards: [], repairStates: [], useVocabularyPerformance: false, now: NOW,
    });
    expect(candidates.find((candidate) => candidate.entry.kanji === '少')).toMatchObject({ eligible: false, exclusionReason: 'insufficient-evidence' });
    expect(candidates.find((candidate) => candidate.entry.kanji === '多')!.direct.reviews).toBe(40);
  });

  it('excludes repairs during cooldown and allows re-entry afterward', () => {
    const directCards = [card(['議'], Array.from({ length: 8 }, (_, index) => ({ rating: 1, daysAgo: index + 1 })))];
    const futureState = state('議', new Date('2026-09-22T12:00:00-04:00'), new Date('2026-10-06T12:00:00-04:00'));
    const cooling = scoreKanjiRepairCandidates({ entries: [entry('議', 1)], directCards, vocabularyCards: [], repairStates: [futureState], useVocabularyPerformance: false, now: NOW });
    expect(cooling[0]).toMatchObject({ eligible: false, exclusionReason: 'cooldown' });
    expect(selectKanjiRepairTarget(cooling)).toBeNull();
    const expired = scoreKanjiRepairCandidates({ entries: [entry('議', 1)], directCards, vocabularyCards: [], repairStates: [{ ...futureState, cooldownUntil: new Date('2026-09-22T00:00:00-04:00') }], useVocabularyPerformance: false, now: NOW });
    expect(expired[0].eligible).toBe(true);
    expect(selectKanjiRepairTarget(expired)?.entry.kanji).toBe('議');
  });

  it('lowers priority when post-repair reviews improve', () => {
    const ratings = [
      ...[30, 25, 20, 15].map((daysAgo) => ({ rating: 1, daysAgo })),
      ...[4, 3, 2, 1].map((daysAgo) => ({ rating: 3, daysAgo })),
    ];
    const noRepair = scoreKanjiRepairCandidates({ entries: [entry('議', 1)], directCards: [card(['議'], ratings)], vocabularyCards: [], repairStates: [], useVocabularyPerformance: false, now: NOW })[0];
    const repaired = scoreKanjiRepairCandidates({
      entries: [entry('議', 1)], directCards: [card(['議'], ratings)], vocabularyCards: [],
      repairStates: [state('議', new Date(NOW.getTime() - 5 * 86_400_000), new Date(NOW.getTime() - 1))],
      useVocabularyPerformance: false, now: NOW,
    })[0];
    expect(repaired.score).toBeLessThan(noRepair.score);
  });

  it('keeps vocabulary scoring inert when disabled and applies it when enabled', () => {
    const directRatings = Array.from({ length: 8 }, (_, index) => ({ rating: 3, daysAgo: index + 1 }));
    const directCards = [card(['会'], directRatings), card(['議'], directRatings)];
    const weakVocabulary = [
      card(['議'], Array.from({ length: 4 }, (_, index) => ({ rating: 1, daysAgo: index + 1 })), 'word-1'),
      card(['議'], Array.from({ length: 4 }, (_, index) => ({ rating: 1, daysAgo: index + 1 })), 'word-2'),
    ];
    const baseInput = { entries: [entry('会', 1), entry('議', 2)], directCards, vocabularyCards: weakVocabulary, repairStates: [], now: NOW };
    const disabled = scoreKanjiRepairCandidates({ ...baseInput, useVocabularyPerformance: false });
    expect(disabled.find((candidate) => candidate.entry.kanji === '会')!.score)
      .toBe(disabled.find((candidate) => candidate.entry.kanji === '議')!.score);
    expect(disabled.every((candidate) => candidate.vocabulary.score === 0)).toBe(true);
    const enabled = scoreKanjiRepairCandidates({ ...baseInput, useVocabularyPerformance: true });
    expect(enabled.find((candidate) => candidate.entry.kanji === '議')!.score)
      .toBeGreaterThan(enabled.find((candidate) => candidate.entry.kanji === '会')!.score);
    expect(enabled.find((candidate) => candidate.entry.kanji === '議')!.vocabulary.available).toBe(true);
  });
});
