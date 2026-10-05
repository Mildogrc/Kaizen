import { describe, expect, it } from 'vitest';
import {
  allGrammarItemsFinished,
  applyConfirmationResult,
  applyPlacementEvaluation,
  buildFinalGrammarResults,
  buildGrammarLessonPrompt,
  buildGrammarTutorLessonPlan,
  classifyGrammarLessonImport,
  completeTaughtGrammarItem,
  grammarResultScheduleError,
  grammarResultFromAppRating,
  grammarLessonMatchesQueue,
  grammarLessonResponseSchema,
  grammarRatingSubmissionSchema,
  initializeGrammarProgress,
  japaneseLevelFromKnownWords,
  jsonValuesEqual,
  newGrammarDueToday,
  nextRequiredGrammarAction,
  parseJsonText,
  requestKnownPointChallenge,
  scheduleGrammarResult,
  selectDailyGrammarVocabulary,
  selectGrammarQueue,
  selectWorstGrammarPoints,
  type GrammarProgress,
  type GrammarPromptItem,
  type GrammarQueueRow,
} from '../src/lib/grammar-coach';

function row(overrides: Partial<GrammarQueueRow> = {}): GrammarQueueRow {
  return {
    learningItemId: 'item',
    status: 'NEW',
    curriculumOrder: 0,
    dueAt: new Date('2026-07-13T12:00:00'),
    introducedAt: null,
    isLeech: false,
    ...overrides,
  };
}

function promptItem(
  learningItemId: string,
  kind: GrammarPromptItem['kind'] = 'new',
): GrammarPromptItem {
  return {
    learningItemId,
    kind,
    pattern: '～んです',
    meaning: 'explanation or emphasis',
    jlptLevel: 'N5',
    examples: ['どうして日本語を勉強しているんですか。 / Why are you studying Japanese?'],
  };
}

function validResult(overrides: Partial<ReturnType<typeof buildFinalGrammarResults>[number]> = {}) {
  return {
    learningItemId: 'grammar-1',
    rating: 'GOOD' as const,
    masteredOnPlacement: false,
    correct: 1,
    total: 2,
    notes: 'Understood the target after one confirmation.',
    diagnostics: {
      scheduledType: 'NEW' as const,
      status: 'completed' as const,
      placementTranslationAttempted: true,
      placementTranslationCorrect: true,
      placementExplanationAttempted: true,
      placementExplanationCorrect: false,
      errors: [],
    },
    ...overrides,
  };
}

function completedProgress(overrides: Partial<GrammarProgress> = {}): GrammarProgress {
  return {
    ...initializeGrammarProgress([promptItem('grammar-1')])[0],
    status: 'completed',
    finalRating: 'GOOD',
    correct: 1,
    total: 1,
    placementTranslationAttempted: true,
    placementTranslationCorrect: true,
    ...overrides,
  };
}

describe('grammar scheduling', () => {
  it('introduces up to five unseen points in one batch', () => {
    const rows = Array.from({ length: 7 }, (_, index) => row({ learningItemId: `new-${index}`, curriculumOrder: index }));
    expect(newGrammarDueToday(rows, new Date('2026-07-13T12:00:00'))).toBe(5);
  });

  it('waits seven calendar days after the latest introduction', () => {
    const rows = [
      row({ learningItemId: 'introduced', status: 'LEARNING', introducedAt: new Date('2026-07-13T12:00:00') }),
      row({ learningItemId: 'next', curriculumOrder: 1 }),
    ];
    expect(newGrammarDueToday(rows, new Date('2026-07-19T12:00:00'))).toBe(0);
    expect(newGrammarDueToday(rows, new Date('2026-07-20T00:01:00'))).toBe(1);
  });

  it('uses a configured batch size and introduction interval', () => {
    const rows = [
      row({ learningItemId: 'introduced', status: 'LEARNING', introducedAt: new Date('2026-07-13T12:00:00') }),
      ...Array.from({ length: 12 }, (_, index) => row({ learningItemId: `new-${index}`, curriculumOrder: index + 1 })),
    ];
    const configuration = { newPointsPerBatch: 9, newBatchIntervalDays: 3 };
    expect(newGrammarDueToday(rows, new Date('2026-07-15T12:00:00'), configuration)).toBe(0);
    expect(newGrammarDueToday(rows, new Date('2026-07-16T00:01:00'), configuration)).toBe(9);
    expect(selectGrammarQueue(rows, new Date('2026-07-16T00:01:00'), configuration).newIds).toHaveLength(9);
  });

  it('prioritizes leeches, then due order, and selects curriculum-order new points', () => {
    const rows = [
      row({ learningItemId: 'new-2', curriculumOrder: 2 }),
      row({ learningItemId: 'new-1', curriculumOrder: 1 }),
      row({ learningItemId: 'review', status: 'REVIEW', dueAt: new Date('2026-07-10T12:00:00') }),
      row({ learningItemId: 'leech', status: 'REVIEW', isLeech: true, dueAt: new Date('2026-07-12T12:00:00') }),
    ];
    expect(selectGrammarQueue(rows, new Date('2026-07-13T12:00:00'))).toEqual({
      reviewIds: ['leech', 'review'],
      newIds: ['new-1', 'new-2'],
    });
  });

  it('moves a new point known on placement directly to mature', () => {
    const now = new Date('2026-07-17T12:00:00');
    const scheduled = scheduleGrammarResult({ status: 'NEW', ease: 2.5, intervalDays: 0, repetitions: 0, lapseCount: 0, isLeech: false }, 'EASY', true, now);
    expect(scheduled.status).toBe('MASTERED');
    expect(scheduled.next.intervalDays).toBe(30);
    expect(scheduled.next.maturity).toBe('MATURE');
  });

  it('keeps an ordinary first easy rating in review', () => {
    const scheduled = scheduleGrammarResult({ status: 'NEW', ease: 2.5, intervalDays: 0, repetitions: 0, lapseCount: 0, isLeech: false }, 'EASY', false, new Date('2026-07-17T12:00:00'));
    expect(scheduled.status).toBe('REVIEW');
    expect(scheduled.next.intervalDays).toBe(4);
  });

  it('rejects generated lessons from an older day or older queue', () => {
    const queue = { reviewIds: ['review'], newIds: ['new'] };
    expect(grammarLessonMatchesQueue({
      scheduledFor: new Date('2026-07-25T10:00:00'),
      grammarItemIds: ['review', 'new'],
    }, queue, new Date('2026-07-25T20:00:00'))).toBe(true);
    expect(grammarLessonMatchesQueue({
      scheduledFor: new Date('2026-07-24T20:00:00'),
      grammarItemIds: ['review', 'new'],
    }, queue, new Date('2026-07-25T20:00:00'))).toBe(false);
    expect(grammarLessonMatchesQueue({
      scheduledFor: new Date('2026-07-25T10:00:00'),
      grammarItemIds: ['review'],
    }, queue, new Date('2026-07-25T20:00:00'))).toBe(false);
  });
});

describe('grammar lesson contract', () => {
  it('derives the learner level from known words', () => {
    expect(japaneseLevelFromKnownWords(1_250)).toContain('upper beginner');
    expect(japaneseLevelFromKnownWords(4_000)).toContain('intermediate');
  });

  it('builds the three-rating grammar-placement-v7 prompt', () => {
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'lesson-1',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items: [promptItem('grammar-1')],
      vocabulary: [
        { source: 'anki-mature', term: '猫' },
        { source: 'migaku', term: '図書館' },
        { source: 'migaku', term: '静か' },
      ],
    });
    expect(prompt).toContain('interactive Japanese grammar coach');
    expect(prompt).toContain('grammar-placement-v7');
    expect(prompt).toContain('Again:');
    expect(prompt).toContain('Good:');
    expect(prompt).toContain('Perfect:');
    expect(prompt).toContain('Words to use: 猫 / 図書館 / 静か');
    expect(prompt).toContain('All three assigned words must be used');
    expect(prompt).toContain('Create exactly one new, natural Japanese sentence');
    expect(prompt).not.toContain('どうして日本語を勉強しているんですか。');
    expect(prompt).not.toContain('Meaning: explanation or emphasis');
    expect(prompt).toContain('1. <Again-or-Good-or-Perfect>');
    expect(prompt).not.toContain('learningItemId:');
    expect(prompt).not.toContain('speedReadingPassage');
    expect(prompt).not.toContain('"grammarResults"');
    expect(prompt).not.toContain('HARD:');
  });

  it('assigns three daily known words to each grammar point', () => {
    const items = [promptItem('grammar-1'), promptItem('grammar-2')];
    const vocabulary = ['猫', '図書館', '静か', '読む', '電車', '早い'].map((term, index) => ({
      source: index % 2 ? 'migaku' as const : 'anki-mature' as const,
      term,
    }));
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'lesson-two-points',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items,
      vocabulary,
    });
    expect(prompt).toContain('Words to use: 猫 / 図書館 / 静か');
    expect(prompt).toContain('Words to use: 読む / 電車 / 早い');
  });

  it('selects stable, deduplicated vocabulary that changes by day', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      source: index % 2 ? 'migaku' as const : 'anki-mature' as const,
      term: `word-${index}`,
      key: `key-${index}`,
    }));
    candidates.push({ source: 'migaku', term: 'duplicate', key: 'key-1' });
    const first = selectDailyGrammarVocabulary(candidates, 9, new Date('2026-09-19T12:00:00'));
    const repeated = selectDailyGrammarVocabulary([...candidates].reverse(), 9, new Date('2026-09-19T20:00:00'));
    const nextDay = selectDailyGrammarVocabulary(candidates, 9, new Date('2026-09-20T12:00:00'));
    expect(first.map((word) => word.key)).toEqual(repeated.map((word) => word.key));
    expect(new Set(first.map((word) => word.key)).size).toBe(9);
    expect(first.map((word) => word.key)).not.toEqual(nextDay.map((word) => word.key));
  });

  it('describes the configured new-grammar schedule in the lesson prompt', () => {
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'lesson-custom-schedule',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items: [promptItem('grammar-1')],
      vocabulary: [],
      newGrammarSchedule: { newPointsPerBatch: 8, newBatchIntervalDays: 4 },
    });
    expect(prompt).toContain('New grammar pace: **8 points every 4 days**');
  });

  it('provides only grammar patterns and words for generated placement sentences', () => {
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'fresh-placement',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items: [{
        ...promptItem('grammar-1'),
        pattern: '～にいく',
        examples: ['本を買いに行く。 / I am going to buy a book.'],
      }],
      vocabulary: [
        { source: 'anki-mature', term: '映画' },
        { source: 'migaku', term: '友達' },
        { source: 'migaku', term: '週末' },
      ],
    });
    expect(prompt).toContain('1. Grammar: ～にいく');
    expect(prompt).toContain('Words to use: 映画 / 友達 / 週末');
    expect(prompt).toContain('Bold only the complete target construction');
    expect(prompt).not.toContain('本を買いに行く。');
    expect(prompt).not.toContain('learningItemId:');
  });

  it('requires numbered ratings instead of JSON final output', () => {
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'lesson-1',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items: [promptItem('grammar-1')],
      vocabulary: [],
    });
    expect(prompt).toContain('output exactly one numbered rating line per point');
    expect(prompt).toContain('Replace every placeholder with exactly Again, Good, or Perfect.');
    expect(prompt).toContain('Do not print anything before or after the numbered list.');
    expect(prompt).toContain('Do not use Hard, Easy, scores, percentages, JSON');
    expect(prompt).not.toContain('valid raw JSON');
  });

  it('maps Perfect to placement mastery only for a new point', () => {
    expect(grammarResultFromAppRating('PERFECT', 'NEW')).toMatchObject({
      rating: 'EASY',
      masteredOnPlacement: true,
      correct: 1,
      total: 1,
    });
    expect(grammarResultFromAppRating('PERFECT', 'REVIEW')).toMatchObject({
      rating: 'EASY',
      masteredOnPlacement: false,
    });
    expect(grammarResultFromAppRating('GOOD', 'NEW')).toMatchObject({
      rating: 'GOOD',
      masteredOnPlacement: false,
    });
  });

  it('accepts only Again, Good, and Perfect app ratings', () => {
    expect(grammarRatingSubmissionSchema.safeParse({
      lessonId: 'lesson-1',
      ratings: [{ learningItemId: 'grammar-1', rating: 'PERFECT' }],
    }).success).toBe(true);
    expect(grammarRatingSubmissionSchema.safeParse({
      lessonId: 'lesson-1',
      ratings: [{ learningItemId: 'grammar-1', rating: 'HARD' }],
    }).success).toBe(false);
  });

  it('builds a tutor plan from the three weakest recurring points', () => {
    const items = [
      { learningItemId: 'one', pattern: '～一', meaning: 'one', jlptLevel: 'N5', examples: ['例一。'], curriculumOrder: 1, totalCorrect: 2, totalQuestions: 10, lapseCount: 2, isLeech: false, lastRating: 'AGAIN' as const },
      { learningItemId: 'two', pattern: '～二', meaning: 'two', jlptLevel: 'N5', examples: ['例二。'], curriculumOrder: 2, totalCorrect: 5, totalQuestions: 10, lapseCount: 1, isLeech: false, lastRating: 'GOOD' as const },
      { learningItemId: 'three', pattern: '～三', meaning: 'three', jlptLevel: 'N4', examples: ['例三。'], curriculumOrder: 3, totalCorrect: 4, totalQuestions: 10, lapseCount: 8, isLeech: true, lastRating: 'AGAIN' as const },
      { learningItemId: 'secure', pattern: '～四', meaning: 'four', jlptLevel: 'N4', examples: ['例四。'], curriculumOrder: 4, totalCorrect: 10, totalQuestions: 10, lapseCount: 0, isLeech: false, lastRating: 'EASY' as const },
    ];
    expect(selectWorstGrammarPoints(items).map((item) => item.learningItemId)).toEqual(['one', 'three', 'two']);
    const plan = buildGrammarTutorLessonPlan(items);
    expect(plan).toContain('percentage of recorded attempts missed');
    expect(plan).toContain('80% missed (8/10 recorded attempts)');
    expect(plan).toContain('～三');
    expect(plan).toContain('～一');
    expect(plan).toContain('～二');
    expect(plan).not.toContain('～四');
  });

  it('applies tutor-only miss rates, plan size, and exclusions', () => {
    const items = [
      { learningItemId: 'one', pattern: '～一', meaning: 'one', jlptLevel: 'N5', examples: [], curriculumOrder: 1, totalCorrect: 1, totalQuestions: 10, lapseCount: 0, isLeech: false, lastRating: 'AGAIN' as const },
      { learningItemId: 'two', pattern: '～二', meaning: 'two', jlptLevel: 'N5', examples: [], curriculumOrder: 2, totalCorrect: 5, totalQuestions: 10, lapseCount: 0, isLeech: false, lastRating: 'GOOD' as const },
      { learningItemId: 'three', pattern: '～三', meaning: 'three', jlptLevel: 'N5', examples: [], curriculumOrder: 3, totalCorrect: 8, totalQuestions: 10, lapseCount: 0, isLeech: false, lastRating: 'GOOD' as const },
    ];
    const configuration = {
      planSize: 2,
      itemOverrides: {
        one: { excluded: true },
        three: { missRatePercent: 75 },
      },
    };
    expect(selectWorstGrammarPoints(items, configuration.planSize, configuration.itemOverrides)
      .map((item) => item.learningItemId)).toEqual(['three', 'two']);
    const plan = buildGrammarTutorLessonPlan(items, configuration);
    expect(plan).toContain('75% missed for tutor planning');
    expect(plan).not.toContain('～一');
  });

  it('masters a fully explained NEW point on placement without later teaching', () => {
    const initial = initializeGrammarProgress([promptItem('grammar-1')])[0];
    const evaluated = applyPlacementEvaluation(initial, {
      translationAttempted: true,
      translationCorrect: true,
      explanationAttempted: true,
      explanationCorrect: true,
    });
    expect(evaluated).toMatchObject({
      status: 'mastered_on_placement',
      finalRating: 'EASY',
      masteredOnPlacement: true,
      correct: 2,
      total: 2,
    });
    expect(nextRequiredGrammarAction([evaluated])).toBeNull();
  });

  it('routes a correct translation without explanation to confirmation', () => {
    const evaluated = applyPlacementEvaluation(
      initializeGrammarProgress([promptItem('grammar-1')])[0],
      {
        translationAttempted: true,
        translationCorrect: true,
        explanationAttempted: false,
        explanationCorrect: null,
      },
    );
    expect(evaluated.status).toBe('needs_confirmation');
    expect(evaluated).toMatchObject({ correct: 1, total: 1 });
    expect(nextRequiredGrammarAction([evaluated])).toEqual({
      learningItemId: 'grammar-1',
      action: 'confirmation',
    });
  });

  it('completes a successful confirmation and skips teaching', () => {
    const confirmation = applyConfirmationResult(
      {
        ...initializeGrammarProgress([promptItem('grammar-1')])[0],
        status: 'needs_confirmation',
      },
      { correct: true, receivedHelp: false },
    );
    expect(confirmation).toMatchObject({
      status: 'completed',
      finalRating: 'GOOD',
      masteredOnPlacement: false,
      correct: 1,
      total: 1,
    });
    expect(nextRequiredGrammarAction([confirmation])).toBeNull();
  });

  it('turns a prior-knowledge claim into one challenge rather than mastery', () => {
    const challenged = requestKnownPointChallenge(
      initializeGrammarProgress([promptItem('grammar-1')])[0],
    );
    expect(challenged).toMatchObject({
      status: 'needs_confirmation',
      masteredOnPlacement: false,
      correct: 0,
      total: 0,
    });
    const completed = applyConfirmationResult(challenged, { correct: true, receivedHelp: false });
    expect(completed.status).toBe('completed');
    expect(completed.masteredOnPlacement).toBe(false);
    expect(completed.total).toBe(1);
  });

  it('keeps target understanding when the primary error is tense', () => {
    const evaluated = applyPlacementEvaluation(
      initializeGrammarProgress([promptItem('grammar-1')])[0],
      {
        translationAttempted: true,
        translationCorrect: false,
        explanationAttempted: true,
        explanationCorrect: true,
        targetGrammarUnderstood: true,
        errors: [{ scope: 'tense', note: '行きます was translated as went.' }],
      },
    );
    expect(evaluated.status).toBe('needs_confirmation');
    expect(evaluated.notes).toContain('[tense] 行きます was translated as went.');
    expect(evaluated).toMatchObject({ correct: 1, total: 2 });
  });

  it('counts only actual assessable attempts', () => {
    const placed = applyPlacementEvaluation(
      initializeGrammarProgress([promptItem('grammar-1')])[0],
      {
        translationAttempted: true,
        translationCorrect: true,
        explanationAttempted: false,
        explanationCorrect: null,
      },
    );
    const confirmed = applyConfirmationResult(placed, { correct: false, receivedHelp: false });
    const completed = completeTaughtGrammarItem(confirmed, {
      rating: 'HARD',
      opportunities: [
        { correct: true },
        { correct: false, errors: [{ scope: 'particle', note: 'Wrong particle.' }] },
      ],
    });
    expect(completed).toMatchObject({ correct: 2, total: 4 });
  });

  it('blocks final JSON while any scheduled item is unfinished', () => {
    const progress = [
      completedProgress(),
      initializeGrammarProgress([promptItem('grammar-2', 'review')])[0],
    ];
    expect(allGrammarItemsFinished(progress)).toBe(false);
    expect(() => buildFinalGrammarResults(progress)).toThrow('blocked');
  });

  it('finalizes every scheduled ID exactly once', () => {
    const newItem = applyPlacementEvaluation(
      initializeGrammarProgress([promptItem('new-1')])[0],
      {
        translationAttempted: true,
        translationCorrect: true,
        explanationAttempted: true,
        explanationCorrect: true,
      },
    );
    const reviewItem = applyPlacementEvaluation(
      initializeGrammarProgress([promptItem('review-1', 'review')])[0],
      {
        translationAttempted: true,
        translationCorrect: true,
        explanationAttempted: true,
        explanationCorrect: true,
      },
    );
    const results = buildFinalGrammarResults([newItem, reviewItem]);
    expect(results.map((result) => result.learningItemId)).toEqual(['new-1', 'review-1']);
    expect(results[1]).toMatchObject({
      masteredOnPlacement: false,
      diagnostics: {
        scheduledType: 'REVIEW',
        status: 'completed',
      },
    });
    expect(grammarResultScheduleError(results, [
      { learningItemId: 'new-1', scheduledType: 'NEW' },
      { learningItemId: 'review-1', scheduledType: 'REVIEW' },
    ])).toBeNull();
  });

  it('accepts fenced valid lesson JSON', () => {
    const parsed = parseJsonText(`\`\`\`json
${JSON.stringify({ lessonId: 'lesson-1', grammarResults: [validResult()] })}
\`\`\``);
    expect(grammarLessonResponseSchema.parse(parsed).lessonId).toBe('lesson-1');
  });

  it('accepts legacy lesson results without diagnostics or session feedback', () => {
    const parsed = grammarLessonResponseSchema.parse({
      lessonId: 'legacy-lesson',
      grammarResults: [{
        learningItemId: 'grammar-1',
        rating: 'GOOD',
        masteredOnPlacement: false,
        correct: 1,
        total: 1,
        notes: 'Legacy diagnostic note.',
      }],
    });
    expect(parsed.grammarResults[0].notes).toBe('Legacy diagnostic note.');
    expect(parsed.grammarResults[0].diagnostics).toBeUndefined();
    expect(parsed.sessionFeedback).toBeUndefined();
  });

  it('accepts diagnostics and session feedback together', () => {
    const parsed = grammarLessonResponseSchema.parse({
      lessonId: 'lesson-1',
      grammarResults: [validResult()],
      sessionFeedback: ['Watch nonpast tense when translating 行きます.'],
    });
    expect(parsed.grammarResults[0].diagnostics?.status).toBe('completed');
    expect(parsed.sessionFeedback).toEqual(['Watch nonpast tense when translating 行きます.']);
  });

  it('rejects placement mastery for REVIEW diagnostics', () => {
    const result = validResult({
      masteredOnPlacement: true,
      rating: 'EASY',
      correct: 2,
      total: 2,
      diagnostics: {
        scheduledType: 'REVIEW',
        status: 'mastered_on_placement',
        placementTranslationAttempted: true,
        placementTranslationCorrect: true,
        placementExplanationAttempted: true,
        placementExplanationCorrect: true,
        errors: [],
      },
    });
    expect(grammarLessonResponseSchema.safeParse({
      lessonId: 'lesson-1',
      grammarResults: [result],
    }).success).toBe(false);
  });

  it('rejects legacy placement mastery when the scheduled item is a REVIEW', () => {
    const error = grammarResultScheduleError([{
      learningItemId: 'review-1',
      rating: 'EASY',
      masteredOnPlacement: true,
      correct: 2,
      total: 2,
      notes: 'Legacy result.',
    }], [{ learningItemId: 'review-1', scheduledType: 'REVIEW' }]);
    expect(error).toContain('masteredOnPlacement');
  });

  it('accepts only the exact speed-reading passage contract', () => {
    const difficulty = japaneseLevelFromKnownWords(1_277);
    const parsed = grammarLessonResponseSchema.parse({
      lessonId: 'lesson-1',
      grammarResults: [validResult()],
      speedReadingPassage: {
        title: 'A short passage',
        topic: 'Japanese learning',
        category: 'Japanese',
        difficulty,
        text: '日本語'.repeat(40),
        questions: [
          {
            id: 'q1',
            prompt: 'What is the passage about?',
            choices: ['Japanese learning', 'Cooking', 'Travel', 'Weather'],
          },
          {
            id: 'q2',
            prompt: 'What should the learner check?',
            choices: ['Comprehension', 'The weather', 'A calendar', 'A map'],
          },
        ],
        answerKey: [
          {
            questionId: 'q1',
            correctIndex: 0,
            explanation: 'The passage discusses Japanese learning.',
          },
          {
            questionId: 'q2',
            correctIndex: 0,
            explanation: 'It recommends checking comprehension.',
          },
        ],
      },
    });

    expect(parsed.speedReadingPassage?.difficulty).toBe(difficulty);
  });

  it('rejects impossible score counts', () => {
    const parsed = grammarLessonResponseSchema.safeParse({
      lessonId: 'lesson-1',
      grammarResults: [validResult({ correct: 2, total: 1 })],
    });
    expect(parsed.success).toBe(false);
  });

  it('compares saved JSON independent of object key order', () => {
    expect(jsonValuesEqual(
      { lessonId: 'lesson-1', grammarResults: [{ rating: 'GOOD', correct: 2 }] },
      { grammarResults: [{ correct: 2, rating: 'GOOD' }], lessonId: 'lesson-1' },
    )).toBe(true);
  });

  it('classifies an identical completed lesson import as a duplicate', () => {
    const response = { lessonId: 'lesson-1', grammarResults: [validResult()] };
    expect(classifyGrammarLessonImport('COMPLETED', response, {
      grammarResults: [validResult()],
      lessonId: 'lesson-1',
    })).toBe('duplicate');
    expect(classifyGrammarLessonImport('GENERATED', null, response)).toBe('new');
  });
});
