/**
 * Central Kanji Repair tuning values.
 *
 * These defaults intentionally favor recent evidence while requiring enough
 * reviews to avoid promoting a kanji after one or two unlucky answers. The UI
 * currently exposes only cooldown length and the optional vocabulary signal;
 * the remaining values stay centralized here for future calibration.
 */
export interface KanjiRepairScoringConfig {
  minimumDirectReviews: number;
  recentReviewWindow: number;
  recentHalfLifeDays: number;
  bayesianPriorReviews: number;
  bayesianPriorFailureRate: number;
  hardFailureWeight: number;
  recentFailureWeight: number;
  lifetimeFailureWeight: number;
  repeatedFailureWeight: number;
  lapseWeight: number;
  difficultyWeight: number;
  responseTimeWeight: number;
  slowResponseFloorMs: number;
  slowResponseCeilingMs: number;
  minimumRepairScore: number;
  cooldownDays: number;
  dailyRepairLimit: number;
  vocabularySignalWeight: number;
  minimumVocabularyReviews: number;
  minimumVocabularyCards: number;
  minimumVocabularyCardReviews: number;
}

export const KANJI_REPAIR_DEFAULTS: KanjiRepairScoringConfig = {
  minimumDirectReviews: 4,
  recentReviewWindow: 8,
  recentHalfLifeDays: 45,
  bayesianPriorReviews: 6,
  bayesianPriorFailureRate: 0.15,
  hardFailureWeight: 0.4,
  recentFailureWeight: 0.42,
  lifetimeFailureWeight: 0.18,
  repeatedFailureWeight: 0.12,
  lapseWeight: 0.1,
  difficultyWeight: 0.1,
  responseTimeWeight: 0.08,
  slowResponseFloorMs: 5_000,
  slowResponseCeilingMs: 15_000,
  minimumRepairScore: 0.2,
  cooldownDays: 14,
  dailyRepairLimit: 1,
  vocabularySignalWeight: 0.3,
  minimumVocabularyReviews: 8,
  minimumVocabularyCards: 2,
  minimumVocabularyCardReviews: 2,
} as const;
