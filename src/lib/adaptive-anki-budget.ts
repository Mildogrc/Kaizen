import { ADAPTIVE_ANKI_CONTROLLER } from './adaptive-anki-config';

const DAY_MS = 86_400_000;

export interface AdaptiveReviewLog {
  ankiCardId: string;
  reviewedAt: Date;
  rating: number;
  timeMs: number;
  reviewType: number | null;
}

export interface AdaptiveEvidenceDay {
  ankiDay: string;
  reviewObservations: number;
  reviewedCardCount: number;
  reviewedCardIds: string[];
  lapsedCardIds: string[];
  reviewMinutes: number | null;
  validTimeObservations: number;
  reviewsDue: number | null;
  reviewsCompleted: number;
  completionRate: number | null;
  retention: number | null;
  reliable: boolean;
  dataAvailable: boolean;
}

export interface AdaptiveBudgetSettings {
  startingBudget: number;
  maximumBudget: number;
  coldStartProtection: boolean;
  targetReviewMinutes: number;
}

export interface AdaptiveBudgetDecision {
  previousBudget: number;
  performanceTarget: number;
  confidenceCeiling: number;
  finalBudget: number;
  windowRetention: number | null;
  retentionAdjustment: number;
  medianReviewMinutes: number | null;
  reviewTimeAdjustment: number;
  repeatLapseRate: number | null;
  lapseAdjustment: number;
  completionRate: number | null;
  backlogRatio: number | null;
  reliableWindowDays: number;
  reasons: string[];
}

export function adaptiveResetState(settings: Pick<AdaptiveBudgetSettings, 'startingBudget'>, now: Date) {
  return { activatedAt: now, currentBudget: settings.startingBudget, reliableDataDays: 0 };
}

export function adaptiveApplicationIsClaimable(
  status: string,
  lastApplyAt: Date | null,
  now: Date,
  staleAfterMs = 5 * 60_000,
): boolean {
  return status === 'pending'
    || status === 'failed'
    || (status === 'applying' && (!lastApplyAt || now.getTime() - lastApplyAt.getTime() >= staleAfterMs));
}

export function ankiDayKey(date: Date, dayStartHour: number): string {
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - dayStartHour);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ankiDayBounds(day: string, dayStartHour: number): { start: Date; end: Date } {
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year, month - 1, date, dayStartHour, 0, 0, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function summarizeAdaptiveEvidenceDay(input: {
  day: string;
  dayStartHour: number;
  activationDay: string;
  logs: AdaptiveReviewLog[];
  reviewsDue: number | null;
  dataAvailable: boolean;
  currentDay: string;
}): AdaptiveEvidenceDay {
  const { start, end } = ankiDayBounds(input.day, input.dayStartHour);
  const logs = input.logs
    .filter((log) => log.reviewedAt >= start && log.reviewedAt < end)
    .sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
  const firstReviewByCard = new Map<string, AdaptiveReviewLog>();
  for (const log of logs) {
    if (log.reviewType === 1 && !firstReviewByCard.has(log.ankiCardId)) {
      firstReviewByCard.set(log.ankiCardId, log);
    }
  }
  const observations = [...firstReviewByCard.values()];
  const validObservationTimes = observations.filter(
    (log) => log.timeMs > 0 && log.timeMs <= ADAPTIVE_ANKI_CONTROLLER.maximumValidReviewTimeMs,
  );
  const validTimes = logs.filter(
    (log) => log.timeMs > 0 && log.timeMs <= ADAPTIVE_ANKI_CONTROLLER.maximumValidReviewTimeMs,
  );
  const scheduledReviews = logs.filter((log) => log.reviewType === 1 || log.reviewType === 2);
  const reviewedCardIds = [...new Set(observations.map((log) => log.ankiCardId))];
  const completedIds = new Set(scheduledReviews.map((log) => log.ankiCardId));
  const failures = observations.filter((log) => log.rating === 1);
  const retention = observations.length > 0
    ? (observations.length - failures.length) / observations.length
    : null;
  const completionRate = input.reviewsDue === null
    ? null
    : input.reviewsDue === 0
      ? 1
      : Math.min(1, completedIds.size / input.reviewsDue);
  const reliable = input.dataAvailable
    && input.day !== input.activationDay
    && input.day < input.currentDay
    && observations.length >= ADAPTIVE_ANKI_CONTROLLER.minimumReviewObservations
    && validObservationTimes.length / observations.length >= ADAPTIVE_ANKI_CONTROLLER.minimumValidTimeRatio;

  return {
    ankiDay: input.day,
    reviewObservations: observations.length,
    reviewedCardCount: reviewedCardIds.length,
    reviewedCardIds,
    lapsedCardIds: failures.map((log) => log.ankiCardId),
    reviewMinutes: validTimes.length > 0
      ? validTimes.reduce((sum, log) => sum + log.timeMs, 0) / 60_000
      : null,
    validTimeObservations: validObservationTimes.length,
    reviewsDue: input.reviewsDue,
    reviewsCompleted: completedIds.size,
    completionRate,
    retention,
    reliable,
    dataAvailable: input.dataAvailable,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function calculateAdaptiveBudget(input: {
  previousBudget: number;
  reliableDataDays: number;
  evidence: AdaptiveEvidenceDay[];
  overdueCount: number;
  settings: AdaptiveBudgetSettings;
}): AdaptiveBudgetDecision {
  const recent = input.evidence
    .filter((day) => day.reliable)
    .sort((a, b) => b.ankiDay.localeCompare(a.ankiDay))
    .slice(0, ADAPTIVE_ANKI_CONTROLLER.evidenceWindowDays);
  const observationTotal = recent.reduce((sum, day) => sum + day.reviewObservations, 0);
  const retainedTotal = recent.reduce(
    (sum, day) => sum + (day.retention ?? 0) * day.reviewObservations,
    0,
  );
  const windowRetention = observationTotal > 0 ? retainedTotal / observationTotal : null;
  const retentionAdjustment = windowRetention === null ? 0
    : windowRetention >= 0.94 ? 3
      : windowRetention >= 0.91 ? 2
        : windowRetention >= 0.87 ? 0
          : windowRetention >= 0.82 ? -3 : -6;
  const medianReviewMinutes = median(recent.flatMap((day) => day.reviewMinutes === null ? [] : [day.reviewMinutes]));
  const target = input.settings.targetReviewMinutes;
  const reviewTimeAdjustment = medianReviewMinutes === null ? 0
    : medianReviewMinutes < target * 0.5 ? 2
      : medianReviewMinutes <= target ? 0
        : medianReviewMinutes <= target * 1.5 ? -2 : -5;
  const lapseDaysByCard = new Map<string, number>();
  const reviewedCards = new Set<string>();
  for (const day of recent) {
    day.reviewedCardIds.forEach((cardId) => reviewedCards.add(cardId));
    new Set(day.lapsedCardIds).forEach((cardId) => lapseDaysByCard.set(cardId, (lapseDaysByCard.get(cardId) ?? 0) + 1));
  }
  const repeatedLapsers = [...lapseDaysByCard.values()].filter((days) => days >= 2).length;
  const repeatLapseRate = reviewedCards.size > 0 ? repeatedLapsers / reviewedCards.size : null;
  const lapseAdjustment = repeatLapseRate === null || repeatLapseRate < 0.1 ? 0
    : repeatLapseRate < 0.15 ? -2
      : repeatLapseRate < 0.2 ? -4 : -7;
  const completionDays = recent.filter((day) => day.reviewsDue !== null);
  const dueTotal = completionDays.reduce((sum, day) => sum + (day.reviewsDue ?? 0), 0);
  const completedTotal = completionDays.reduce((sum, day) => sum + day.reviewsCompleted, 0);
  const completionRate = completionDays.length === 0 ? null : dueTotal === 0 ? 1 : Math.min(1, completedTotal / dueTotal);
  const performanceTarget = clamp(
    input.previousBudget + retentionAdjustment + reviewTimeAdjustment + lapseAdjustment,
    0,
    input.settings.maximumBudget,
  );
  const confidenceCeiling = input.settings.coldStartProtection
    ? Math.min(
      input.settings.maximumBudget,
      input.settings.startingBudget
        + ADAPTIVE_ANKI_CONTROLLER.confidenceStepCards
        * Math.floor(input.reliableDataDays / ADAPTIVE_ANKI_CONTROLLER.confidenceStepDays),
    )
    : input.settings.maximumBudget;
  const reasons: string[] = [];
  let finalBudget = performanceTarget > input.previousBudget
    ? Math.min(performanceTarget, confidenceCeiling)
    : performanceTarget;
  if (performanceTarget > input.previousBudget
    && (completionDays.length < ADAPTIVE_ANKI_CONTROLLER.minimumCompletionDaysForIncrease
      || completionRate === null
      || completionRate < ADAPTIVE_ANKI_CONTROLLER.completionIncreaseThreshold)) {
    finalBudget = Math.min(finalBudget, input.previousBudget);
    reasons.push('Increase blocked until at least three reliable days have 95% review completion.');
  }
  if (performanceTarget > confidenceCeiling) reasons.push(`Cold-start ceiling limited the budget to ${confidenceCeiling}.`);
  const normalWorkload = median(recent.map((day) => day.reviewedCardCount)) ?? 0;
  const moderateThreshold = Math.max(ADAPTIVE_ANKI_CONTROLLER.moderateBacklogMinimum, normalWorkload);
  const seriousThreshold = Math.max(ADAPTIVE_ANKI_CONTROLLER.seriousBacklogMinimum, normalWorkload * 2);
  const backlogRatio = normalWorkload > 0 ? input.overdueCount / normalWorkload : null;
  if (input.overdueCount >= seriousThreshold) {
    finalBudget = 0;
    reasons.push('A serious overdue-review backlog paused new cards.');
  } else if (input.overdueCount >= moderateThreshold) {
    finalBudget = Math.min(finalBudget, Math.floor(input.previousBudget / 2));
    reasons.push('An overdue-review backlog halved the new-card budget.');
  }
  if (windowRetention !== null) reasons.push(`Recent true retention was ${(windowRetention * 100).toFixed(1)}%.`);
  if (medianReviewMinutes !== null) reasons.push(`Median daily review time was ${medianReviewMinutes.toFixed(1)} minutes.`);
  if (recent.length === 0) reasons.push('No reliable post-activation evidence yet; the starting budget remains conservative.');

  return {
    previousBudget: input.previousBudget,
    performanceTarget,
    confidenceCeiling,
    finalBudget,
    windowRetention,
    retentionAdjustment,
    medianReviewMinutes,
    reviewTimeAdjustment,
    repeatLapseRate,
    lapseAdjustment,
    completionRate,
    backlogRatio,
    reliableWindowDays: recent.length,
    reasons,
  };
}

export function allocateAdaptiveBudget(
  budget: number,
  decks: Array<{ mappingId: string; deckName: string; availableNew: number }>,
): Array<{ mappingId: string; deckName: string; availableNew: number; budget: number }> {
  const clean = decks.map((deck) => ({ ...deck, availableNew: Math.max(0, Math.floor(deck.availableNew)) }));
  const available = clean.reduce((sum, deck) => sum + deck.availableNew, 0);
  const total = Math.min(Math.max(0, Math.floor(budget)), available);
  if (total === 0 || available === 0) return clean.map((deck) => ({ ...deck, budget: 0 }));
  const shares = clean.map((deck) => {
    const exact = total * deck.availableNew / available;
    const base = Math.min(deck.availableNew, Math.floor(exact));
    return { ...deck, budget: base, remainder: exact - base };
  });
  let remaining = total - shares.reduce((sum, deck) => sum + deck.budget, 0);
  for (const deck of [...shares].sort((a, b) => b.remainder - a.remainder || a.mappingId.localeCompare(b.mappingId))) {
    if (remaining === 0) break;
    if (deck.budget < deck.availableNew) {
      deck.budget += 1;
      remaining -= 1;
    }
  }
  return shares.map((deck) => ({
    mappingId: deck.mappingId,
    deckName: deck.deckName,
    availableNew: deck.availableNew,
    budget: deck.budget,
  }));
}
