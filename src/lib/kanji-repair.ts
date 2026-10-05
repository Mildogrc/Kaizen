import type { LogRow } from './anki-analytics';
import type { RtkKanjiEntry } from './kanji-extract';
import { KANJI_REPAIR_DEFAULTS, type KanjiRepairScoringConfig } from './kanji-repair-config';

const DAY_MS = 86_400_000;

export interface KanjiRepairEvidenceCard {
  ankiCardId: string;
  label: string;
  kanji: string[];
  intervalDays: number;
  ease: number;
  lapses: number;
  logs: LogRow[];
}

export interface KanjiRepairStateEvidence {
  kanji: string;
  lastRepairedAt: Date;
  cooldownUntil: Date;
  repairCount: number;
  lastRepairScore: number;
  performanceAtRepair?: unknown;
}

export interface DirectKanjiPerformance {
  cards: number;
  reviews: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  recentReviews: number;
  recentFailures: number;
  recentFailureRate: number;
  lifetimeFailureRate: number;
  lapses: number;
  averageResponseMs: number | null;
  intervalDays: number;
  ease: number;
  confidence: number;
  score: number;
}

export interface VocabularyKanjiEvidence {
  cardId: string;
  word: string;
  reviews: number;
  failures: number;
  weakness: number;
  attribution: number;
  contribution: number;
}

export interface VocabularyKanjiPerformance {
  enabled: boolean;
  available: boolean;
  cards: number;
  reviews: number;
  attributedReviews: number;
  score: number;
  evidence: VocabularyKanjiEvidence[];
}

export interface KanjiRepairCandidate {
  entry: RtkKanjiEntry;
  direct: DirectKanjiPerformance;
  vocabulary: VocabularyKanjiPerformance;
  repairState: KanjiRepairStateEvidence | null;
  score: number;
  eligible: boolean;
  exclusionReason: 'cooldown' | 'insufficient-evidence' | 'below-threshold' | null;
}

export interface ScoreKanjiRepairInput {
  entries: RtkKanjiEntry[];
  directCards: KanjiRepairEvidenceCard[];
  vocabularyCards: KanjiRepairEvidenceCard[];
  repairStates: KanjiRepairStateEvidence[];
  useVocabularyPerformance: boolean;
  now?: Date;
  config?: KanjiRepairScoringConfig;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function extractKanjiCharacters(text: string): string[] {
  return [...new Set([...text.matchAll(/\p{Script=Han}/gu)].map((match) => match[0]))];
}

export function isDirectKanjiDeckName(deckName: string): boolean {
  return /(?:kanji|rtk|remembering the kanji)/i.test(deckName);
}

function ratingFailure(rating: number, config: KanjiRepairScoringConfig): number {
  if (rating === 1) return 1;
  if (rating === 2) return config.hardFailureWeight;
  return 0;
}

function weightedFailure(logs: LogRow[], now: Date, config: KanjiRepairScoringConfig): number {
  if (logs.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;
  for (const log of logs) {
    const ageDays = Math.max(0, (now.getTime() - log.reviewedAt.getTime()) / DAY_MS);
    const weight = 0.5 ** (ageDays / config.recentHalfLifeDays);
    numerator += ratingFailure(log.rating, config) * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function smoothedLifetimeFailure(logs: LogRow[], config: KanjiRepairScoringConfig): number {
  const observedFailures = logs.reduce((sum, log) => sum + ratingFailure(log.rating, config), 0);
  return (observedFailures + config.bayesianPriorFailureRate * config.bayesianPriorReviews)
    / (logs.length + config.bayesianPriorReviews);
}

function average(values: number[], fallback: number): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function directPerformance(
  cards: KanjiRepairEvidenceCard[],
  state: KanjiRepairStateEvidence | null,
  now: Date,
  config: KanjiRepairScoringConfig,
): DirectKanjiPerformance {
  const logs = cards.flatMap((card) => card.logs).sort((left, right) => right.reviewedAt.getTime() - left.reviewedAt.getTime());
  const recent = logs.slice(0, config.recentReviewWindow);
  const postRepair = state
    ? logs.filter((log) => log.reviewedAt > state.lastRepairedAt).slice(0, config.recentReviewWindow)
    : [];
  const recentBase = weightedFailure(recent, now, config);
  const recentFailureRate = postRepair.length > 0
    ? weightedFailure(postRepair, now, config) * 0.75 + recentBase * 0.25
    : recentBase;
  const lifetimeFailureRate = smoothedLifetimeFailure(logs, config);
  const repeatedFailure = clamp01(recent.filter((log) => log.rating === 1).length / 3);
  const lapses = cards.reduce((sum, card) => sum + card.lapses, 0);
  const lapseSignal = 1 - Math.exp(-lapses / 3);
  const intervalDays = average(cards.map((card) => card.intervalDays), 0);
  const ease = average(cards.map((card) => card.ease), 2.5);
  const intervalDifficulty = 1 - clamp01(intervalDays / 180);
  const easeDifficulty = clamp01((2.5 - ease) / 1.2);
  const difficultySignal = intervalDifficulty * 0.6 + easeDifficulty * 0.4;
  const responseTimes = recent.map((log) => Math.min(60_000, Math.max(0, log.timeMs))).filter((time) => time > 0);
  const averageResponseMs = responseTimes.length ? average(responseTimes, 0) : null;
  const responseSignal = averageResponseMs == null
    ? 0
    : clamp01((averageResponseMs - config.slowResponseFloorMs) / (config.slowResponseCeilingMs - config.slowResponseFloorMs));
  const confidence = clamp01(Math.sqrt(logs.length / (config.minimumDirectReviews * 3)));

  // Recent errors dominate. Lifetime errors are Bayesian-smoothed, while
  // lapses, short intervals/low ease, and slow responses act as smaller
  // supporting signals. Confidence prevents tiny samples from dominating.
  const score = clamp01((
    recentFailureRate * config.recentFailureWeight
    + lifetimeFailureRate * config.lifetimeFailureWeight
    + repeatedFailure * config.repeatedFailureWeight
    + lapseSignal * config.lapseWeight
    + difficultySignal * config.difficultyWeight
    + responseSignal * config.responseTimeWeight
  ) * confidence);

  return {
    cards: cards.length,
    reviews: logs.length,
    again: logs.filter((log) => log.rating === 1).length,
    hard: logs.filter((log) => log.rating === 2).length,
    good: logs.filter((log) => log.rating === 3).length,
    easy: logs.filter((log) => log.rating === 4).length,
    recentReviews: recent.length,
    recentFailures: recent.filter((log) => log.rating === 1).length,
    recentFailureRate,
    lifetimeFailureRate,
    lapses,
    averageResponseMs,
    intervalDays,
    ease,
    confidence,
    score,
  };
}

interface VocabularyAccumulator {
  cards: Set<string>;
  reviews: number;
  attributedReviews: number;
  numerator: number;
  evidence: VocabularyKanjiEvidence[];
}

function vocabularyPerformance(
  cards: KanjiRepairEvidenceCard[],
  directByKanji: Map<string, DirectKanjiPerformance>,
  enabled: boolean,
  now: Date,
  config: KanjiRepairScoringConfig,
): Map<string, VocabularyKanjiPerformance> {
  const output = new Map<string, VocabularyKanjiPerformance>();
  if (!enabled) return output;

  const scoredCards = cards.flatMap((card) => {
    if (card.logs.length < config.minimumVocabularyCardReviews || card.kanji.length === 0) return [];
    const sorted = [...card.logs].sort((left, right) => right.reviewedAt.getTime() - left.reviewedAt.getTime());
    const recent = sorted.slice(0, config.recentReviewWindow);
    const confidence = clamp01(Math.sqrt(sorted.length / config.minimumVocabularyReviews));
    const weakness = clamp01((
      weightedFailure(recent, now, config) * 0.7
      + smoothedLifetimeFailure(sorted, config) * 0.3
    ) * confidence);
    return [{ card, weakness }];
  });
  const corpusBaseline = scoredCards.length
    ? average(scoredCards.map((row) => row.weakness), 0)
    : 0;
  const accumulators = new Map<string, VocabularyAccumulator>();

  for (const { card, weakness } of scoredCards) {
    // A difficult multi-kanji word does not penalize every character equally.
    // Attribution starts with an even 0.5 prior, then leans toward characters
    // that also have direct RTK weakness. We also subtract part of the corpus
    // baseline so a generally difficult vocabulary deck is less likely to
    // make every character look weak.
    const attributionWeights = card.kanji.map((kanji) => 0.5 + (directByKanji.get(kanji)?.score ?? 0));
    const totalAttribution = attributionWeights.reduce((sum, value) => sum + value, 0);
    const cardSpecificWeakness = Math.max(0, weakness - corpusBaseline * 0.25);
    card.kanji.forEach((kanji, index) => {
      const attribution = totalAttribution > 0 ? attributionWeights[index] / totalAttribution : 1 / card.kanji.length;
      const contribution = cardSpecificWeakness * attribution;
      const accumulator = accumulators.get(kanji) ?? {
        cards: new Set<string>(), reviews: 0, attributedReviews: 0, numerator: 0, evidence: [],
      };
      accumulator.cards.add(card.ankiCardId);
      accumulator.reviews += card.logs.length;
      accumulator.attributedReviews += card.logs.length * attribution;
      accumulator.numerator += contribution * card.logs.length;
      accumulator.evidence.push({
        cardId: card.ankiCardId,
        word: card.label,
        reviews: card.logs.length,
        failures: card.logs.filter((log) => log.rating === 1).length,
        weakness,
        attribution,
        contribution,
      });
      accumulators.set(kanji, accumulator);
    });
  }

  for (const [kanji, accumulator] of accumulators) {
    const available = accumulator.cards.size >= config.minimumVocabularyCards
      && accumulator.attributedReviews >= config.minimumVocabularyReviews;
    const confidence = clamp01(Math.sqrt(accumulator.attributedReviews / config.minimumVocabularyReviews));
    output.set(kanji, {
      enabled: true,
      available,
      cards: accumulator.cards.size,
      reviews: accumulator.reviews,
      attributedReviews: accumulator.attributedReviews,
      score: available ? clamp01((accumulator.numerator / Math.max(1, accumulator.reviews)) * confidence) : 0,
      evidence: accumulator.evidence
        .sort((left, right) => right.contribution - left.contribution)
        .slice(0, 8),
    });
  }
  return output;
}

export function scoreKanjiRepairCandidates(input: ScoreKanjiRepairInput): KanjiRepairCandidate[] {
  const now = input.now ?? new Date();
  const config = input.config ?? KANJI_REPAIR_DEFAULTS;
  const states = new Map(input.repairStates.map((state) => [state.kanji, state]));
  const directCardsByKanji = new Map<string, KanjiRepairEvidenceCard[]>();
  for (const card of input.directCards) {
    for (const kanji of card.kanji) {
      directCardsByKanji.set(kanji, [...(directCardsByKanji.get(kanji) ?? []), card]);
    }
  }
  const directByKanji = new Map(input.entries.map((entry) => {
    const state = states.get(entry.kanji) ?? null;
    return [entry.kanji, directPerformance(directCardsByKanji.get(entry.kanji) ?? [], state, now, config)] as const;
  }));
  const vocabularyByKanji = vocabularyPerformance(
    input.vocabularyCards,
    directByKanji,
    input.useVocabularyPerformance,
    now,
    config,
  );

  return input.entries.map((entry) => {
    const direct = directByKanji.get(entry.kanji)!;
    const vocabulary = vocabularyByKanji.get(entry.kanji) ?? {
      enabled: input.useVocabularyPerformance,
      available: false,
      cards: 0,
      reviews: 0,
      attributedReviews: 0,
      score: 0,
      evidence: [],
    };
    const repairState = states.get(entry.kanji) ?? null;
    const score = clamp01(direct.score + (input.useVocabularyPerformance ? vocabulary.score * config.vocabularySignalWeight : 0));
    const hasEvidence = direct.reviews >= config.minimumDirectReviews || vocabulary.available;
    const onCooldown = Boolean(repairState && repairState.cooldownUntil > now);
    const exclusionReason = onCooldown
      ? 'cooldown' as const
      : !hasEvidence
        ? 'insufficient-evidence' as const
        : score < config.minimumRepairScore
          ? 'below-threshold' as const
          : null;
    return {
      entry,
      direct,
      vocabulary,
      repairState,
      score,
      eligible: exclusionReason === null,
      exclusionReason,
    };
  }).sort((left, right) => right.score - left.score
    || (left.entry.rtkNumber ?? Number.MAX_SAFE_INTEGER) - (right.entry.rtkNumber ?? Number.MAX_SAFE_INTEGER));
}

export function selectKanjiRepairTarget(candidates: KanjiRepairCandidate[]): KanjiRepairCandidate | null {
  return candidates.find((candidate) => candidate.eligible) ?? null;
}

export function kanjiRepairPerformanceSnapshot(candidate: KanjiRepairCandidate): Record<string, unknown> {
  return {
    capturedAt: new Date().toISOString(),
    score: candidate.score,
    direct: candidate.direct,
    vocabulary: candidate.vocabulary,
  };
}
