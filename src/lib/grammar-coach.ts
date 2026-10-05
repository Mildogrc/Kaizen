import { z } from 'zod';
import {
  DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION,
  DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION,
  type JapaneseGrammarConfiguration,
  type JapaneseGrammarTutorConfiguration,
  type JapaneseGrammarTutorItemOverride,
} from './app-settings';
import { rate, type Rating, type SrsState } from './srs';

export const GRAMMAR_NEW_PER_WEEK = DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION.newPointsPerBatch;
export const GRAMMAR_REVIEW_LIMIT = 12;
export const GRAMMAR_NEW_INTERVAL_DAYS = DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION.newBatchIntervalDays;
export const GRAMMAR_FIRST_TRY_MATURE_DAYS = 30;
export const GRAMMAR_PROMPT_VERSION = 'grammar-placement-v7';

export const GRAMMAR_APP_RATINGS = ['AGAIN', 'GOOD', 'PERFECT'] as const;
export type GrammarAppRating = (typeof GRAMMAR_APP_RATINGS)[number];

export type GrammarStatus =
  | 'untested'
  | 'mastered_on_placement'
  | 'needs_confirmation'
  | 'needs_teaching'
  | 'completed';

export type ErrorScope =
  | 'target_grammar'
  | 'tense'
  | 'aspect'
  | 'vocabulary'
  | 'english_naturalness'
  | 'particle'
  | 'other';

export interface GrammarProgress {
  learningItemId: string;
  scheduledType: 'NEW' | 'REVIEW';
  status: GrammarStatus;
  correct: number;
  total: number;
  placementTranslationAttempted: boolean;
  placementTranslationCorrect: boolean | null;
  placementExplanationAttempted: boolean;
  placementExplanationCorrect: boolean | null;
  masteredOnPlacement: boolean;
  finalRating?: Rating;
  notes: string[];
}

export interface GrammarError {
  scope: ErrorScope;
  note: string;
}

export interface PlacementEvaluation {
  translationAttempted: boolean;
  translationCorrect: boolean | null;
  explanationAttempted: boolean;
  explanationCorrect: boolean | null;
  targetGrammarUnderstood?: boolean;
  minorTargetError?: boolean;
  fundamentalMisunderstanding?: boolean;
  errors?: GrammarError[];
}

export interface GrammarQueueRow {
  learningItemId: string;
  status: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  curriculumOrder: number;
  dueAt: Date;
  introducedAt: Date | null;
  isLeech: boolean;
}

export interface GrammarPromptItem {
  learningItemId: string;
  kind: 'new' | 'review';
  pattern: string;
  meaning: string;
  jlptLevel: string;
  examples: string[];
  notes?: string;
}

export interface GeneratedGrammarLesson {
  scheduledFor: Date;
  grammarItemIds: unknown;
}

export interface LessonVocabulary {
  source: 'anki-mature' | 'migaku' | 'anki-leech' | 'known-word';
  term: string;
  reading?: string;
  key?: string;
  meaning?: string;
  lapses?: number;
}

export interface GrammarTutorPlanItem {
  learningItemId: string;
  pattern: string;
  meaning: string;
  jlptLevel: string;
  examples: string[];
  curriculumOrder: number;
  totalCorrect: number;
  totalQuestions: number;
  lapseCount: number;
  isLeech: boolean;
  lastRating: Rating | null;
}

export const grammarRatingSubmissionSchema = z.object({
  lessonId: z.string().trim().min(1),
  ratings: z.array(z.object({
    learningItemId: z.string().trim().min(1),
    rating: z.enum(GRAMMAR_APP_RATINGS),
  }).strict()).min(1).superRefine((ratings, context) => {
    const ids = ratings.map((rating) => rating.learningItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Each grammar point must have exactly one rating.' });
    }
  }),
}).strict();

export type GrammarRatingSubmission = z.infer<typeof grammarRatingSubmissionSchema>;

export function grammarResultFromAppRating(rating: GrammarAppRating, scheduledType: 'NEW' | 'REVIEW') {
  const perfect = rating === 'PERFECT';
  return {
    rating: perfect ? 'EASY' as const : rating,
    masteredOnPlacement: perfect && scheduledType === 'NEW',
    correct: rating === 'AGAIN' ? 0 : 1,
    total: 1,
    notes: rating === 'PERFECT'
      ? scheduledType === 'NEW' ? 'Rated Perfect on first exposure.' : 'Rated Perfect on review.'
      : rating === 'GOOD' ? 'Rated Good in the app.' : 'Rated Again in the app.',
  };
}

export const speedReadingPassageInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  difficulty: z.string().trim().min(1).max(120),
  sourceUrl: z.string().url().optional(),
  text: z.string().trim().min(100).refine(
    (text) => countJapaneseCharacters(text) >= 100,
    { message: 'The passage must contain at least 100 Japanese characters.' },
  ),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(1),
    choices: z.array(z.string().trim().min(1)).length(4),
  }).strict()).length(2),
  answerKey: z.array(z.object({
    questionId: z.string().trim().min(1).max(40),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(1),
  }).strict()).length(2),
}).strict().superRefine((passage, context) => {
  const questionIds = passage.questions.map((question) => question.id);
  const answerIds = passage.answerKey.map((answer) => answer.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Question IDs must be unique.' });
  }
  if (new Set(answerIds).size !== answerIds.length) {
    context.addIssue({ code: 'custom', path: ['answerKey'], message: 'Answer-key IDs must be unique.' });
  }
  if (questionIds.length !== answerIds.length || questionIds.some((id) => !answerIds.includes(id))) {
    context.addIssue({ code: 'custom', path: ['answerKey'], message: 'Answer-key IDs must match the question IDs exactly.' });
  }
});

const grammarDiagnosticsSchema = z.object({
  scheduledType: z.enum(['NEW', 'REVIEW']),
  status: z.enum(['mastered_on_placement', 'completed']),
  placementTranslationAttempted: z.boolean(),
  placementTranslationCorrect: z.boolean().nullable(),
  placementExplanationAttempted: z.boolean(),
  placementExplanationCorrect: z.boolean().nullable(),
  errors: z.array(z.object({
    scope: z.enum(['target_grammar', 'tense', 'aspect', 'vocabulary', 'english_naturalness', 'particle', 'other']),
    note: z.string().trim().min(1).max(500),
  }).strict()).max(50),
}).strict().superRefine((diagnostics, context) => {
  if (diagnostics.placementTranslationAttempted !== (diagnostics.placementTranslationCorrect !== null)) {
    context.addIssue({ code: 'custom', path: ['placementTranslationCorrect'], message: 'Translation correctness must be null exactly when no translation was attempted.' });
  }
  if (diagnostics.placementExplanationAttempted !== (diagnostics.placementExplanationCorrect !== null)) {
    context.addIssue({ code: 'custom', path: ['placementExplanationCorrect'], message: 'Explanation correctness must be null exactly when no explanation was attempted.' });
  }
  if (diagnostics.scheduledType === 'REVIEW' && diagnostics.status !== 'completed') {
    context.addIssue({ code: 'custom', path: ['status'], message: 'REVIEW items must end with completed status.' });
  }
});

export const grammarLessonResponseSchema = z.object({
  lessonId: z.string().trim().min(1),
  grammarResults: z.array(z.object({
    learningItemId: z.string().trim().min(1),
    rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']),
    masteredOnPlacement: z.boolean(),
    correct: z.number().int().min(0),
    total: z.number().int().min(0),
    notes: z.string().trim().max(2000).default(''),
    diagnostics: grammarDiagnosticsSchema.optional(),
  }).strict().superRefine((result, context) => {
    if (result.correct > result.total) {
      context.addIssue({ code: 'custom', path: ['correct'], message: 'Correct answers cannot exceed total opportunities.' });
    }
    const diagnostics = result.diagnostics;
    if (!diagnostics) {
      if (result.masteredOnPlacement && result.rating !== 'EASY') {
        context.addIssue({ code: 'custom', path: ['rating'], message: 'A point mastered on placement must have an EASY rating.' });
      }
      return;
    }

    const placementTotal = Number(diagnostics.placementTranslationAttempted) + Number(diagnostics.placementExplanationAttempted);
    const placementCorrect = Number(diagnostics.placementTranslationCorrect === true) + Number(diagnostics.placementExplanationCorrect === true);
    if (result.total < placementTotal) {
      context.addIssue({ code: 'custom', path: ['total'], message: 'Total opportunities cannot be lower than the recorded placement attempts.' });
    }
    if (result.correct < placementCorrect) {
      context.addIssue({ code: 'custom', path: ['correct'], message: 'Correct opportunities cannot be lower than the correct placement attempts.' });
    }
    if (diagnostics.scheduledType === 'REVIEW' && result.masteredOnPlacement) {
      context.addIssue({ code: 'custom', path: ['masteredOnPlacement'], message: 'REVIEW items must have masteredOnPlacement set to false.' });
    }
    if (result.masteredOnPlacement) {
      if (diagnostics.scheduledType !== 'NEW') {
        context.addIssue({ code: 'custom', path: ['masteredOnPlacement'], message: 'Only NEW items can be mastered on placement.' });
      }
      if (diagnostics.status !== 'mastered_on_placement' || result.rating !== 'EASY') {
        context.addIssue({ code: 'custom', path: ['diagnostics', 'status'], message: 'A point mastered on placement must have mastered_on_placement status and an EASY rating.' });
      }
      if (!diagnostics.placementTranslationCorrect || !diagnostics.placementExplanationCorrect) {
        context.addIssue({ code: 'custom', path: ['masteredOnPlacement'], message: 'Placement mastery requires a correct translation and explanation.' });
      }
      if (result.correct !== 2 || result.total !== 2) {
        context.addIssue({ code: 'custom', path: ['total'], message: 'An item mastered on placement must contain exactly its two successful placement opportunities.' });
      }
    } else if (diagnostics.status === 'mastered_on_placement') {
      context.addIssue({ code: 'custom', path: ['diagnostics', 'status'], message: 'mastered_on_placement status requires masteredOnPlacement to be true.' });
    }
  })).min(1).superRefine((results, context) => {
    const ids = results.map((result) => result.learningItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Every learningItemId must appear exactly once.' });
    }
  }),
  sessionFeedback: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  speedReadingPassage: speedReadingPassageInputSchema.optional(),
}).strict();

export type GrammarLessonResponse = z.infer<typeof grammarLessonResponseSchema>;

export function countJapaneseCharacters(text: string): number {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
}

export function initializeGrammarProgress(items: GrammarPromptItem[]): GrammarProgress[] {
  return items.map((item) => ({
    learningItemId: item.learningItemId,
    scheduledType: item.kind === 'new' ? 'NEW' : 'REVIEW',
    status: 'untested',
    correct: 0,
    total: 0,
    placementTranslationAttempted: false,
    placementTranslationCorrect: null,
    placementExplanationAttempted: false,
    placementExplanationCorrect: null,
    masteredOnPlacement: false,
    notes: [],
  }));
}

function errorNotes(errors: GrammarError[] = []): string[] {
  return errors.map((error) => `[${error.scope}] ${error.note}`);
}

export function applyPlacementEvaluation(
  progress: GrammarProgress,
  evaluation: PlacementEvaluation,
): GrammarProgress {
  const total = progress.total
    + Number(evaluation.translationAttempted)
    + Number(evaluation.explanationAttempted);
  const correct = progress.correct
    + Number(evaluation.translationAttempted && evaluation.translationCorrect === true)
    + Number(evaluation.explanationAttempted && evaluation.explanationCorrect === true);
  const next: GrammarProgress = {
    ...progress,
    correct,
    total,
    placementTranslationAttempted: evaluation.translationAttempted,
    placementTranslationCorrect: evaluation.translationAttempted ? evaluation.translationCorrect : null,
    placementExplanationAttempted: evaluation.explanationAttempted,
    placementExplanationCorrect: evaluation.explanationAttempted ? evaluation.explanationCorrect : null,
    notes: [...progress.notes, ...errorNotes(evaluation.errors)],
  };

  if (evaluation.translationCorrect === true && evaluation.explanationCorrect === true) {
    return progress.scheduledType === 'NEW'
      ? { ...next, status: 'mastered_on_placement', masteredOnPlacement: true, finalRating: 'EASY' }
      : { ...next, status: 'completed', masteredOnPlacement: false, finalRating: 'EASY' };
  }

  if (evaluation.fundamentalMisunderstanding) {
    return { ...next, status: 'needs_teaching', masteredOnPlacement: false };
  }

  const errors = evaluation.errors ?? [];
  const onlyUnrelatedErrors = errors.length > 0 && errors.every((error) => error.scope !== 'target_grammar');
  if (
    evaluation.translationCorrect === true
    || evaluation.targetGrammarUnderstood
    || evaluation.minorTargetError
    || onlyUnrelatedErrors
  ) {
    return { ...next, status: 'needs_confirmation', masteredOnPlacement: false };
  }

  return { ...next, status: 'needs_teaching', masteredOnPlacement: false };
}

export function requestKnownPointChallenge(progress: GrammarProgress): GrammarProgress {
  if (progress.status === 'mastered_on_placement' || progress.status === 'completed') return progress;
  return {
    ...progress,
    status: 'needs_confirmation',
    masteredOnPlacement: false,
    notes: [...progress.notes, '[other] Learner requested a skip; ask exactly one concise challenge before completing this item.'],
  };
}

export function applyConfirmationResult(
  progress: GrammarProgress,
  input: { correct: boolean; receivedHelp: boolean; errors?: GrammarError[] },
): GrammarProgress {
  const next = {
    ...progress,
    correct: progress.correct + Number(input.correct),
    total: progress.total + 1,
    masteredOnPlacement: false,
    notes: [...progress.notes, ...errorNotes(input.errors)],
  };
  if (input.correct && !input.receivedHelp) {
    return { ...next, status: 'completed' as const, finalRating: 'GOOD' as const };
  }
  return { ...next, status: 'needs_teaching' as const, finalRating: undefined };
}

export function completeTaughtGrammarItem(
  progress: GrammarProgress,
  input: { rating: Exclude<Rating, 'EASY'> | 'EASY'; opportunities: Array<{ correct: boolean; errors?: GrammarError[] }> },
): GrammarProgress {
  const notes = input.opportunities.flatMap((opportunity) => errorNotes(opportunity.errors));
  return {
    ...progress,
    status: 'completed',
    correct: progress.correct + input.opportunities.filter((opportunity) => opportunity.correct).length,
    total: progress.total + input.opportunities.length,
    masteredOnPlacement: false,
    finalRating: input.rating,
    notes: [...progress.notes, ...notes],
  };
}

export function allGrammarItemsFinished(progress: GrammarProgress[]): boolean {
  return progress.every((item) => item.status === 'mastered_on_placement' || item.status === 'completed');
}

export function nextRequiredGrammarAction(
  progress: GrammarProgress[],
): { learningItemId: string; action: 'placement' | 'confirmation' | 'teaching' } | null {
  const item = progress.find((candidate) => candidate.status !== 'mastered_on_placement' && candidate.status !== 'completed');
  if (!item) return null;
  if (item.status === 'untested') return { learningItemId: item.learningItemId, action: 'placement' };
  if (item.status === 'needs_confirmation') return { learningItemId: item.learningItemId, action: 'confirmation' };
  return { learningItemId: item.learningItemId, action: 'teaching' };
}

export function buildFinalGrammarResults(progress: GrammarProgress[]): GrammarLessonResponse['grammarResults'] {
  if (!allGrammarItemsFinished(progress)) {
    throw new Error('Final JSON is blocked until every scheduled grammar item is finished.');
  }
  return progress.map((item) => {
    if (item.status !== 'mastered_on_placement' && item.status !== 'completed') {
      throw new Error(`Grammar item ${item.learningItemId} is unfinished.`);
    }
    if (!item.finalRating) throw new Error(`Grammar item ${item.learningItemId} has no final rating.`);
    if (item.scheduledType === 'REVIEW' && (item.status !== 'completed' || item.masteredOnPlacement)) {
      throw new Error(`REVIEW item ${item.learningItemId} must be completed without placement mastery.`);
    }
    const errors = item.notes.map((note) => {
      const match = note.match(/^\[(target_grammar|tense|aspect|vocabulary|english_naturalness|particle|other)\]\s+(.+)$/u);
      return match
        ? { scope: match[1] as ErrorScope, note: match[2] }
        : { scope: 'other' as const, note };
    });
    return {
      learningItemId: item.learningItemId,
      rating: item.finalRating,
      masteredOnPlacement: item.masteredOnPlacement,
      correct: item.correct,
      total: item.total,
      notes: item.notes.join(' '),
      diagnostics: {
        scheduledType: item.scheduledType,
        status: item.status,
        placementTranslationAttempted: item.placementTranslationAttempted,
        placementTranslationCorrect: item.placementTranslationCorrect,
        placementExplanationAttempted: item.placementExplanationAttempted,
        placementExplanationCorrect: item.placementExplanationCorrect,
        errors,
      },
    };
  });
}

export function grammarResultScheduleError(
  results: GrammarLessonResponse['grammarResults'],
  scheduledItems: Array<{ learningItemId: string; scheduledType: 'NEW' | 'REVIEW' }>,
): string | null {
  const expectedIds = scheduledItems.map((item) => item.learningItemId);
  const resultIds = results.map((result) => result.learningItemId);
  const uniqueResultIds = new Set(resultIds);
  if (uniqueResultIds.size !== resultIds.length) {
    return 'The JSON contains a duplicate learningItemId. Keep exactly one result for each scheduled grammar point.';
  }
  const missingIds = expectedIds.filter((id) => !uniqueResultIds.has(id));
  const unexpectedIds = resultIds.filter((id) => !expectedIds.includes(id));
  if (expectedIds.length !== resultIds.length || missingIds.length || unexpectedIds.length) {
    const details = [
      missingIds.length ? `${missingIds.length} scheduled result${missingIds.length === 1 ? ' is' : 's are'} missing` : null,
      unexpectedIds.length ? `${unexpectedIds.length} result${unexpectedIds.length === 1 ? ' does' : 's do'} not belong to this lesson` : null,
    ].filter(Boolean).join('; ');
    return `The grammar results do not match this lesson${details ? `: ${details}` : ''}. Copy the final JSON from the current lesson prompt.`;
  }
  const expectedTypes = new Map(scheduledItems.map((item) => [item.learningItemId, item.scheduledType]));
  for (const result of results) {
    const expectedType = expectedTypes.get(result.learningItemId);
    if (result.diagnostics && result.diagnostics.scheduledType !== expectedType) {
      return `The scheduledType for ${result.learningItemId} is incorrect. Use the NEW or REVIEW value from the current lesson prompt.`;
    }
    if (expectedType === 'REVIEW') {
      if (result.masteredOnPlacement) {
        return `REVIEW item ${result.learningItemId} must have masteredOnPlacement set to false.`;
      }
      if (result.diagnostics && result.diagnostics.status !== 'completed') {
        return `REVIEW item ${result.learningItemId} must end with completed status.`;
      }
    }
  }
  return null;
}

export function scheduleGrammarResult(
  state: SrsState & { status: GrammarQueueRow['status'] },
  rating: Rating,
  masteredOnPlacement: boolean,
  now: Date = new Date(),
) {
  const next = rate(state, rating, now);
  if (state.status === 'NEW' && masteredOnPlacement) {
    return {
      status: 'MASTERED' as const,
      next: {
        ...next,
        intervalDays: GRAMMAR_FIRST_TRY_MATURE_DAYS,
        dueAt: new Date(now.getTime() + GRAMMAR_FIRST_TRY_MATURE_DAYS * 86_400_000),
        maturity: 'MATURE' as const,
      },
    };
  }
  return {
    status: next.intervalDays >= 21 ? 'MASTERED' as const : next.intervalDays >= 1 ? 'REVIEW' as const : 'LEARNING' as const,
    next,
  };
}

function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function nextGrammarBatchAt(
  rows: GrammarQueueRow[],
  configuration: JapaneseGrammarConfiguration = DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION,
): Date | null {
  if (!rows.some((row) => row.status === 'NEW')) return null;
  const latestIntroduction = rows.reduce<Date | null>((latest, row) => {
    if (!row.introducedAt || (latest && row.introducedAt <= latest)) return latest;
    return row.introducedAt;
  }, null);
  if (!latestIntroduction) return null;
  const nextBatch = startOfDay(latestIntroduction);
  nextBatch.setDate(nextBatch.getDate() + configuration.newBatchIntervalDays);
  return nextBatch;
}

export function newGrammarDueToday(
  rows: GrammarQueueRow[],
  now: Date,
  configuration: JapaneseGrammarConfiguration = DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION,
): number {
  const unseenCount = rows.filter((row) => row.status === 'NEW').length;
  if (!unseenCount) return 0;
  const nextBatch = nextGrammarBatchAt(rows, configuration);
  if (nextBatch && startOfDay(now) < nextBatch) return 0;
  return Math.min(configuration.newPointsPerBatch, unseenCount);
}

export function selectGrammarQueue(
  rows: GrammarQueueRow[],
  now: Date = new Date(),
  configuration: JapaneseGrammarConfiguration = DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION,
): {
  reviewIds: string[];
  newIds: string[];
} {
  const reviewIds = rows
    .filter((row) => row.status !== 'NEW' && row.dueAt <= now)
    .sort((left, right) => {
      if (left.isLeech !== right.isLeech) return left.isLeech ? -1 : 1;
      return left.dueAt.getTime() - right.dueAt.getTime() || left.curriculumOrder - right.curriculumOrder;
    })
    .slice(0, GRAMMAR_REVIEW_LIMIT)
    .map((row) => row.learningItemId);

  const newIds = rows
    .filter((row) => row.status === 'NEW')
    .sort((left, right) => left.curriculumOrder - right.curriculumOrder)
    .slice(0, newGrammarDueToday(rows, now, configuration))
    .map((row) => row.learningItemId);

  return { reviewIds, newIds };
}

export function grammarLessonMatchesQueue(
  lesson: GeneratedGrammarLesson,
  queue: { reviewIds: string[]; newIds: string[] },
  now: Date = new Date(),
): boolean {
  if (startOfDay(lesson.scheduledFor).getTime() !== startOfDay(now).getTime()) return false;
  if (!Array.isArray(lesson.grammarItemIds)) return false;
  const actualIds = lesson.grammarItemIds.filter((id): id is string => typeof id === 'string');
  const expectedIds = [...queue.reviewIds, ...queue.newIds];
  return actualIds.length === expectedIds.length && actualIds.every((id, index) => id === expectedIds[index]);
}

export function japaneseLevelFromKnownWords(knownWords: number): string {
  if (knownWords < 500) return 'absolute beginner (pre-JLPT N5 vocabulary)';
  if (knownWords < 800) return 'beginner (early JLPT N5 vocabulary)';
  if (knownWords < 1_500) return 'upper beginner (strong N5, approaching N4 vocabulary)';
  if (knownWords < 3_750) return 'lower intermediate (approximately N4–N3 vocabulary)';
  if (knownWords < 6_000) return 'intermediate (approximately N3–N2 vocabulary)';
  if (knownWords < 10_000) return 'upper intermediate (approximately N2 vocabulary)';
  return 'advanced (approximately N1+ vocabulary)';
}

export function parseJsonText(input: string): unknown {
  const trimmed = input.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(unfenced);
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizedJson(child)]),
  );
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizedJson(left)) === JSON.stringify(normalizedJson(right));
}

export function classifyGrammarLessonImport(
  status: 'GENERATED' | 'COMPLETED',
  savedResponse: unknown,
  incomingResponse: unknown,
): 'new' | 'duplicate' | 'conflict' {
  if (status !== 'COMPLETED') return 'new';
  return jsonValuesEqual(savedResponse, incomingResponse) ? 'duplicate' : 'conflict';
}

export function recordedGrammarMissRatePercent(item: GrammarTutorPlanItem): number {
  if (item.totalQuestions <= 0) return 0;
  const misses = Math.max(0, item.totalQuestions - item.totalCorrect);
  return Math.round((misses / item.totalQuestions) * 100);
}

export function grammarTutorMissRatePercent(
  item: GrammarTutorPlanItem,
  override?: JapaneseGrammarTutorItemOverride,
): number {
  return override?.missRatePercent ?? recordedGrammarMissRatePercent(item);
}

export function selectWorstGrammarPoints(
  items: GrammarTutorPlanItem[],
  limit = 3,
  itemOverrides: Record<string, JapaneseGrammarTutorItemOverride> = {},
): GrammarTutorPlanItem[] {
  return items
    .filter((item) => {
      const override = itemOverrides[item.learningItemId];
      if (override?.excluded) return false;
      return grammarTutorMissRatePercent(item, override) > 0
        || item.lapseCount > 0
        || item.isLeech
        || item.lastRating === 'AGAIN'
        || item.lastRating === 'HARD';
    })
    .sort((left, right) => {
      const leftMissRate = grammarTutorMissRatePercent(left, itemOverrides[left.learningItemId]);
      const rightMissRate = grammarTutorMissRatePercent(right, itemOverrides[right.learningItemId]);
      return rightMissRate - leftMissRate
        || Number(right.isLeech) - Number(left.isLeech)
        || right.lapseCount - left.lapseCount
        || right.totalQuestions - left.totalQuestions
        || left.curriculumOrder - right.curriculumOrder;
    })
    .slice(0, Math.max(0, limit));
}

export function buildGrammarTutorLessonPlan(
  items: GrammarTutorPlanItem[],
  configuration: JapaneseGrammarTutorConfiguration = DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION,
): string {
  const selected = selectWorstGrammarPoints(items, configuration.planSize, configuration.itemOverrides);
  if (!selected.length) return '';
  const rows = selected.map((item, index) => {
    const misses = Math.max(0, item.totalQuestions - item.totalCorrect);
    const recordedMissRate = recordedGrammarMissRatePercent(item);
    const override = configuration.itemOverrides[item.learningItemId];
    const missRate = grammarTutorMissRatePercent(item, override);
    const history = override?.missRatePercent == null
      ? `${missRate}% missed (${misses}/${item.totalQuestions} recorded attempts)`
      : `${missRate}% missed for tutor planning (manually set; recorded history is ${recordedMissRate}% or ${misses}/${item.totalQuestions})`;
    return [
      `${index + 1}. ${item.pattern} (${item.jlptLevel}) — ${item.meaning}`,
      `   History: ${history}; ${item.lapseCount} SRS lapses${item.isLeech ? '; currently marked as a leech' : ''}.`,
      item.examples.length ? `   Reference example: ${item.examples[0]}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `# Japanese grammar tutor lesson plan

Please spend this session expanding and correcting the learner's weakest recurring grammar points. These were selected primarily by percentage of recorded attempts missed, with lapses and leech status used as supporting signals. Tutor-plan overrides and exclusions have already been applied.

${rows}

For each point:
1. Diagnose the learner with one fresh recognition or translation example.
2. Explain formation, meaning, register, and the most important nuance or contrast.
3. Compare it with one easily confused construction when useful.
4. Ask for one controlled production sentence and one natural conversational use.
5. Correct vocabulary, particles, tense, and naturalness separately from the target grammar.

Spend the most time on errors that recur. Do not mark a point secure merely because the learner recognizes the explanation.`;
}

function vocabularyDateKey(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
}

function vocabularySeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectDailyGrammarVocabulary(
  candidates: LessonVocabulary[],
  count: number,
  date: Date,
): LessonVocabulary[] {
  const unique = new Map<string, LessonVocabulary>();
  for (const candidate of [...candidates].sort((left, right) => {
    const leftKey = left.key ?? `${left.term}|${left.reading ?? ''}`;
    const rightKey = right.key ?? `${right.term}|${right.reading ?? ''}`;
    return leftKey.localeCompare(rightKey) || left.source.localeCompare(right.source);
  })) {
    const key = candidate.key?.trim() || `${candidate.term.trim()}|${candidate.reading?.trim() ?? ''}`;
    if (candidate.term.trim() && !unique.has(key)) unique.set(key, { ...candidate, key });
  }

  const shuffled = [...unique.values()];
  let state = vocabularySeed(vocabularyDateKey(date));
  const random = () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.max(0, count));
}

export function buildGrammarLessonPrompt(input: {
  lessonId: string;
  levelLabel: string;
  knownWords: number;
  items: GrammarPromptItem[];
  vocabulary: LessonVocabulary[];
  newGrammarSchedule?: JapaneseGrammarConfiguration;
}): string {
  const newGrammarSchedule = input.newGrammarSchedule ?? DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION;
  const itemRows = input.items.map((item, index) => [
    `${index + 1}. Grammar: ${item.pattern}`,
    `   Words to use: ${input.vocabulary.slice(index * 3, index * 3 + 3).map((word) => word.term).join(' / ') || 'No assigned words'}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  const finalResultRows = input.items.map((_, index) => `${index + 1}. <Again-or-Good-or-Perfect>`).join('\n');

  return `# Today's Japanese grammar lesson

Prompt version: ${GRAMMAR_PROMPT_VERSION}

You are my interactive Japanese grammar coach. Finish every scheduled grammar point before moving to secondary Japanese feedback. The scheduled grammar points are the lesson; do not introduce random grammar problems.

## Learner profile

- Algorithmic level estimate: **${input.levelLabel}**
- Conservative known-word count: **${input.knownWords.toLocaleString()}**
- New grammar pace: **${newGrammarSchedule.newPointsPerBatch} points every ${newGrammarSchedule.newBatchIntervalDays} ${newGrammarSchedule.newBatchIntervalDays === 1 ? 'day' : 'days'}**
- The assigned words come from mature Anki cards and imported Migaku known words.

## Daily vocabulary assignments

Each grammar point below has three words selected by the app for today. Use all three assigned words across the generated placement sentence, explanation examples, confirmation question, or production practice for that grammar point. They do not all need to appear in one sentence. Do not replace them with your usual stock nouns and verbs. All three assigned words must be used before that grammar point receives its final rating.

## Grammar points and words

${itemRows}

No curriculum examples have been supplied. Create every sentence yourself from the grammar pattern and assigned words.

## First response: generate a fresh placement check

Create exactly one new, natural Japanese sentence for each numbered grammar point above. For each sentence:

- Use the target grammar construction correctly and naturally.
- Use at least one of that point's three assigned words.
- Bold only the complete target construction, not the entire sentence.
- Do not name the grammar pattern, explain it, translate it, or reveal its meaning.
- Do not reuse a sentence from a previous lesson or fall back to a stock textbook sentence.

Print only the numbered Japanese sentences in the same order as the grammar points. Then ask me to translate each sentence and explain the bold target construction. Wait for my answer before teaching anything.

## Lesson flow

1. Grade the placement translation and explanation for each numbered grammar point.
2. If the target grammar is clearly understood, do not overteach it.
3. If understanding is uncertain, ask exactly one focused confirmation question.
4. If the target grammar is misunderstood, explain formation, meaning, and nuance, then test it with a fresh example.
5. Keep progressing automatically until every numbered point has a final rating. Do not ask whether I want to continue.
6. After the grammar points are finished, briefly explain and correct only Japanese issues that actually occurred, such as word choice, particles, tense, naturalness, or nuance.

An unrelated vocabulary or English-naturalness mistake must not erase demonstrated understanding of the target grammar.

## Rating rubric

- Again: the target grammar was still fundamentally misunderstood or unusable after teaching.
- Good: the target grammar was understood after a correction, hint, confirmation, or meaningful effort.
- Perfect: immediate, complete command of the target grammar without help.

Do not use Hard, Easy, scores, percentages, JSON, learningItemIds, explanations, or commentary in the final output.

## Final output

After every scheduled point is finished, output exactly one numbered rating line per point in the original order:

${finalResultRows}

Replace every placeholder with exactly Again, Good, or Perfect. The app will interpret Perfect as EASY for a review item and as mastered on placement for a NEW item. Do not print anything before or after the numbered list.
`;
}
