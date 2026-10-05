export const ADAPTIVE_ANKI_DEFAULTS = {
  enabled: false,
  startingBudget: 10,
  maximumBudget: 40,
  coldStartProtection: true,
  targetReviewMinutes: 60,
  ankiDayStartHour: 4,
} as const;

export const ADAPTIVE_ANKI_CONTROLLER = {
  evidenceWindowDays: 7,
  minimumReviewObservations: 20,
  minimumValidTimeRatio: 0.8,
  minimumCompletionDaysForIncrease: 3,
  completionIncreaseThreshold: 0.95,
  confidenceStepDays: 7,
  confidenceStepCards: 2,
  maximumValidReviewTimeMs: 120_000,
  moderateBacklogMinimum: 10,
  seriousBacklogMinimum: 20,
} as const;
