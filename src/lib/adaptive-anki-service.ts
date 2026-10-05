import { prisma } from './db';
import { japaneseAdaptiveAnkiConfiguration } from './app-settings';
import {
  ankiDayBounds,
  ankiDayKey,
  adaptiveApplicationIsClaimable,
  adaptiveResetState,
  calculateAdaptiveBudget,
  summarizeAdaptiveEvidenceDay,
  type AdaptiveEvidenceDay,
} from './adaptive-anki-budget';
import {
  applyAdaptiveBudgetToAnki,
  restoreAdaptiveDeckPreset,
  type AdaptiveDeckState,
} from './adaptive-anki-application';

function json(value: unknown): object {
  return JSON.parse(JSON.stringify(value)) as object;
}

function nextDayKey(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(year, month - 1, date + 1, 12);
  return ankiDayKey(next, 0);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function evidenceFromRecord(record: {
  ankiDay: string;
  reviewObservations: number;
  reviewedCardCount: number;
  reviewedCardIds: unknown;
  lapsedCardIds: unknown;
  reviewMinutes: number | null;
  validTimeObservations: number;
  reviewsDue: number | null;
  reviewsCompleted: number;
  completionRate: number | null;
  retention: number | null;
  reliable: boolean;
  dataAvailable: boolean;
}): AdaptiveEvidenceDay {
  return {
    ...record,
    reviewedCardIds: stringArray(record.reviewedCardIds),
    lapsedCardIds: stringArray(record.lapsedCardIds),
  };
}

export async function restoreAdaptiveAnkiDecks(): Promise<void> {
  const states = await prisma.ankiAdaptiveDeckState.findMany({ include: { mapping: true } });
  for (const state of states) {
    const result = await restoreAdaptiveDeckPreset({
      deckName: state.mapping.deckName,
      state: {
        originalConfigId: state.originalConfigId,
        managedConfigId: state.managedConfigId,
        managedConfigName: state.managedConfigName,
      },
    });
    if (result.ok) {
      await prisma.ankiAdaptiveDeckState.delete({ where: { id: state.id } });
    } else {
      await prisma.ankiAdaptiveDeckState.update({
        where: { id: state.id },
        data: { restorePending: true, lastError: result.error ?? 'The original preset could not be restored.' },
      });
    }
  }
}

export async function resetAdaptiveAnkiController(userId: string, now = new Date()): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const settings = japaneseAdaptiveAnkiConfiguration(user.settings);
  const reset = adaptiveResetState(settings, now);
  await prisma.$transaction([
    prisma.ankiAdaptiveEvidenceDay.deleteMany({ where: { userId } }),
    prisma.ankiAdaptiveBudgetDecision.deleteMany({ where: { userId } }),
    prisma.ankiAdaptiveBudgetState.upsert({
      where: { userId },
      create: { userId, ...reset },
      update: reset,
    }),
  ]);
}

export async function reconcileAdaptiveAnkiAfterSync(now = new Date()): Promise<void> {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const settings = japaneseAdaptiveAnkiConfiguration(user.settings);
  if (!settings.enabled) {
    await restoreAdaptiveAnkiDecks();
    return;
  }
  const mappings = await prisma.ankiDeckMapping.findMany({
    where: { adaptiveNewCards: true, course: { slug: 'japanese' } },
    include: { adaptiveDeckState: true },
  });
  const selectedIds = new Set(mappings.map((mapping) => mapping.id));
  const staleStates = await prisma.ankiAdaptiveDeckState.findMany({ include: { mapping: true } });
  for (const stale of staleStates.filter((state) => !selectedIds.has(state.mappingId))) {
    const restored = await restoreAdaptiveDeckPreset({
      deckName: stale.mapping.deckName,
      state: stale,
    });
    if (restored.ok) await prisma.ankiAdaptiveDeckState.delete({ where: { id: stale.id } });
    else await prisma.ankiAdaptiveDeckState.update({ where: { id: stale.id }, data: { restorePending: true, lastError: restored.error } });
  }
  if (mappings.length === 0) return;

  let state = await prisma.ankiAdaptiveBudgetState.findUnique({ where: { userId: user.id } });
  if (!state) {
    state = await prisma.ankiAdaptiveBudgetState.create({
      data: { userId: user.id, activatedAt: now, currentBudget: settings.startingBudget },
    });
  }
  const currentDay = ankiDayKey(now, settings.ankiDayStartHour);
  const activationDay = ankiDayKey(state.activatedAt, settings.ankiDayStartHour);
  const mappingIds = mappings.map((mapping) => mapping.id);
  const logs = await prisma.ankiReviewLog.findMany({
    where: { mappingId: { in: mappingIds }, reviewedAt: { gte: state.activatedAt } },
    select: { ankiCardId: true, reviewedAt: true, rating: true, timeMs: true, reviewType: true },
    orderBy: { reviewedAt: 'asc' },
  });
  const decisions = await prisma.ankiAdaptiveBudgetDecision.findMany({
    where: { userId: user.id },
    select: { ankiDay: true, dueAtCalculation: true },
  });
  const dueByDay = new Map(decisions.map((decision) => [decision.ankiDay, decision.dueAtCalculation]));
  for (let day = nextDayKey(activationDay); day < currentDay; day = nextDayKey(day)) {
    const bounds = ankiDayBounds(day, settings.ankiDayStartHour);
    const dataAvailable = mappings.every((mapping) => mapping.lastSyncedAt && mapping.lastSyncedAt >= bounds.end);
    const summary = summarizeAdaptiveEvidenceDay({
      day,
      dayStartHour: settings.ankiDayStartHour,
      activationDay,
      logs: logs.map((log) => ({
        ankiCardId: String(log.ankiCardId),
        reviewedAt: log.reviewedAt,
        rating: log.rating,
        timeMs: log.timeMs,
        reviewType: log.reviewType,
      })),
      reviewsDue: dueByDay.get(day) ?? null,
      dataAvailable: Boolean(dataAvailable),
      currentDay,
    });
    await prisma.ankiAdaptiveEvidenceDay.upsert({
      where: { userId_ankiDay: { userId: user.id, ankiDay: day } },
      create: { userId: user.id, ...summary, reviewedCardIds: json(summary.reviewedCardIds), lapsedCardIds: json(summary.lapsedCardIds) },
      update: { ...summary, reviewedCardIds: json(summary.reviewedCardIds), lapsedCardIds: json(summary.lapsedCardIds), finalizedAt: now },
    });
  }
  const evidenceRecords = await prisma.ankiAdaptiveEvidenceDay.findMany({
    where: { userId: user.id },
    orderBy: { ankiDay: 'desc' },
  });
  const reliableDataDays = evidenceRecords.filter((day) => day.reliable).length;
  state = await prisma.ankiAdaptiveBudgetState.update({
    where: { userId: user.id },
    data: { reliableDataDays },
  });

  let decision = await prisma.ankiAdaptiveBudgetDecision.findUnique({
    where: { userId_ankiDay: { userId: user.id, ankiDay: currentDay } },
  });
  if (!decision) {
    const { start, end } = ankiDayBounds(currentDay, settings.ankiDayStartHour);
    const dueCards = await prisma.ankiCardSnapshot.findMany({
      where: {
        mappingId: { in: mappingIds },
        dueAt: { lte: end },
        state: { in: ['LEARNING', 'YOUNG', 'MATURE'] },
      },
      select: { ankiCardId: true, dueAt: true },
    });
    const completedToday = logs.filter(
      (log) => log.reviewedAt >= start && log.reviewedAt < end && (log.reviewType === 1 || log.reviewType === 2),
    );
    const dueIds = new Set(dueCards.map((card) => String(card.ankiCardId)));
    completedToday.forEach((log) => dueIds.add(String(log.ankiCardId)));
    const overdueCount = dueCards.filter((card) => card.dueAt && card.dueAt < start).length;
    const calculated = calculateAdaptiveBudget({
      previousBudget: state.currentBudget,
      reliableDataDays,
      evidence: evidenceRecords.map(evidenceFromRecord),
      overdueCount,
      settings,
    });
    decision = await prisma.ankiAdaptiveBudgetDecision.upsert({
      where: { userId_ankiDay: { userId: user.id, ankiDay: currentDay } },
      create: {
        userId: user.id,
        ankiDay: currentDay,
        previousBudget: calculated.previousBudget,
        performanceTarget: calculated.performanceTarget,
        confidenceCeiling: calculated.confidenceCeiling,
        finalBudget: calculated.finalBudget,
        windowRetention: calculated.windowRetention,
        retentionAdjustment: calculated.retentionAdjustment,
        medianReviewMinutes: calculated.medianReviewMinutes,
        reviewTimeAdjustment: calculated.reviewTimeAdjustment,
        repeatLapseRate: calculated.repeatLapseRate,
        lapseAdjustment: calculated.lapseAdjustment,
        completionRate: calculated.completionRate,
        overdueCount,
        backlogRatio: calculated.backlogRatio,
        reliableDataDays,
        reliableWindowDays: calculated.reliableWindowDays,
        dueAtCalculation: dueIds.size,
        reasons: json(calculated.reasons),
      },
      update: {},
    });
    await prisma.ankiAdaptiveBudgetState.update({
      where: { userId: user.id },
      data: { currentBudget: calculated.finalBudget },
    });
  }
  if (!adaptiveApplicationIsClaimable(decision.applyStatus, decision.lastApplyAt, now)) return;
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const claim = await prisma.ankiAdaptiveBudgetDecision.updateMany({
    where: {
      id: decision.id,
      OR: [
        { applyStatus: { in: ['pending', 'failed'] } },
        { applyStatus: 'applying', OR: [{ lastApplyAt: null }, { lastApplyAt: { lte: staleBefore } }] },
      ],
    },
    data: { applyStatus: 'applying', lastApplyAt: now },
  });
  if (claim.count === 0) return;

  const results = await applyAdaptiveBudgetToAnki({
    budget: decision.finalBudget,
    decks: mappings.map((mapping) => ({
      mappingId: mapping.id,
      deckName: mapping.deckName,
      state: mapping.adaptiveDeckState as AdaptiveDeckState | null,
    })),
  });
  for (const result of results) {
    if (result.state) {
      await prisma.ankiAdaptiveDeckState.upsert({
        where: { mappingId: result.mappingId },
        create: {
          mappingId: result.mappingId,
          ...result.state,
          lastAppliedBudget: result.ok ? result.budget : null,
          lastAppliedAt: result.ok ? now : null,
          lastError: result.error,
        },
        update: {
          ...result.state,
          lastAppliedBudget: result.ok ? result.budget : undefined,
          lastAppliedAt: result.ok ? now : undefined,
          restorePending: false,
          lastError: result.error ?? null,
        },
      });
    }
  }
  const failures = results.filter((result) => !result.ok);
  await prisma.ankiAdaptiveBudgetDecision.update({
    where: { id: decision.id },
    data: {
      allocation: json(results.map((result) => ({
        mappingId: result.mappingId,
        deckName: result.deckName,
        availableNew: result.availableNew,
        budget: result.budget,
        ok: result.ok,
        error: result.error,
      }))),
      applyStatus: failures.length === 0 ? 'applied' : 'failed',
      applyError: failures.length === 0 ? null : failures.map((failure) => `${failure.deckName}: ${failure.error}`).join(' '),
      lastApplyAt: now,
    },
  });
}

export async function adaptiveAnkiDashboard() {
  const user = await prisma.user.findFirst();
  if (!user) return null;
  const settings = japaneseAdaptiveAnkiConfiguration(user.settings);
  const [state, latestDecision, history, mappings] = await Promise.all([
    prisma.ankiAdaptiveBudgetState.findUnique({ where: { userId: user.id } }),
    prisma.ankiAdaptiveBudgetDecision.findFirst({ where: { userId: user.id }, orderBy: { calculatedAt: 'desc' } }),
    prisma.ankiAdaptiveBudgetDecision.findMany({ where: { userId: user.id }, orderBy: { calculatedAt: 'desc' }, take: 14 }),
    prisma.ankiDeckMapping.findMany({
      where: { course: { slug: 'japanese' } },
      include: { adaptiveDeckState: true },
      orderBy: { deckName: 'asc' },
    }),
  ]);
  return { userId: user.id, settings, state, latestDecision, history, mappings };
}
