import { z } from 'zod';
import { rate, type Rating, type SrsState } from './srs';

export const GRAMMAR_NEW_PER_WEEK = 5;
export const GRAMMAR_REVIEW_LIMIT = 12;
export const GRAMMAR_NEW_INTERVAL_DAYS = 7;
export const GRAMMAR_FIRST_TRY_MATURE_DAYS = 30;
export const GRAMMAR_PROMPT_VERSION = 'grammar-placement-v3';

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

export interface LessonVocabulary {
  source: 'anki-leech' | 'known-word';
  term: string;
  meaning?: string;
  lapses?: number;
}

export const speedReadingPassageInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  difficulty: z.string().trim().min(1).max(40),
  sourceUrl: z.string().url().optional(),
  text: z.string().trim().min(100),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(1),
    choices: z.array(z.string().trim().min(1)).min(2).max(6),
  }).strict()).min(2).max(10),
  answerKey: z.array(z.object({
    questionId: z.string().trim().min(1).max(40),
    correctIndex: z.number().int().min(0).max(5),
    explanation: z.string().trim().min(1),
  }).strict()).min(2).max(10),
}).strict();

export const grammarLessonResponseSchema = z.object({
  lessonId: z.string().trim().min(1),
  grammarResults: z.array(z.object({
    learningItemId: z.string().trim().min(1),
    rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']),
    masteredOnPlacement: z.boolean(),
    correct: z.number().int().min(0),
    total: z.number().int().min(1),
    notes: z.string().trim().max(1000).optional(),
  }).strict().refine(
    (result) => !result.masteredOnPlacement || result.rating === 'EASY',
    { message: 'A point mastered on placement must have an EASY rating.' },
  )).min(1),
  speedReadingPassage: speedReadingPassageInputSchema.optional(),
}).strict();

export type GrammarLessonResponse = z.infer<typeof grammarLessonResponseSchema>;

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

export function nextGrammarBatchAt(rows: GrammarQueueRow[]): Date | null {
  if (!rows.some((row) => row.status === 'NEW')) return null;
  const latestIntroduction = rows.reduce<Date | null>((latest, row) => {
    if (!row.introducedAt || (latest && row.introducedAt <= latest)) return latest;
    return row.introducedAt;
  }, null);
  if (!latestIntroduction) return null;
  const nextBatch = startOfDay(latestIntroduction);
  nextBatch.setDate(nextBatch.getDate() + GRAMMAR_NEW_INTERVAL_DAYS);
  return nextBatch;
}

export function newGrammarDueToday(rows: GrammarQueueRow[], now: Date): number {
  const unseenCount = rows.filter((row) => row.status === 'NEW').length;
  if (!unseenCount) return 0;
  const nextBatch = nextGrammarBatchAt(rows);
  if (nextBatch && startOfDay(now) < nextBatch) return 0;
  return Math.min(GRAMMAR_NEW_PER_WEEK, unseenCount);
}

export function selectGrammarQueue(rows: GrammarQueueRow[], now: Date = new Date()): {
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
    .slice(0, newGrammarDueToday(rows, now))
    .map((row) => row.learningItemId);

  return { reviewIds, newIds };
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

export function buildGrammarLessonPrompt(input: {
  lessonId: string;
  levelLabel: string;
  knownWords: number;
  items: GrammarPromptItem[];
  vocabulary: LessonVocabulary[];
}): string {
  const itemRows = input.items.map((item, index) => [
    `${index + 1}. [${item.kind.toUpperCase()}] ${item.pattern} (${item.jlptLevel})`,
    `   Meaning: ${item.meaning}`,
    item.examples.length ? `   Examples: ${item.examples.join(' | ')}` : null,
    item.notes ? `   Notes: ${item.notes}` : null,
    `   learningItemId: ${item.learningItemId}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  const vocabulary = input.vocabulary.length
    ? input.vocabulary.map((word) => `- ${word.term}${word.meaning ? ` — ${word.meaning}` : ''}${word.lapses ? ` (${word.lapses} lapses)` : ''}`).join('\n')
    : '- No vocabulary anchors were supplied. Choose words appropriate for the stated level.';
  const responseExample = {
    lessonId: input.lessonId,
    grammarResults: input.items.map((item) => ({
      learningItemId: item.learningItemId,
      rating: 'GOOD',
      masteredOnPlacement: false,
      correct: 2,
      total: 3,
      notes: 'Brief diagnostic note',
    })),
    speedReadingPassage: {
      title: 'A short Japanese reading',
      topic: 'Everyday learning',
      category: 'Japanese',
      difficulty: input.levelLabel,
      text: 'Write at least 100 characters of natural Japanese reading that reinforces today\'s grammar. The passage should be self-contained, coherent, and suitable for timed reading practice.',
      questions: [
        { id: 'q1', prompt: 'Question based only on the passage', choices: ['A', 'B', 'C', 'D'] },
        { id: 'q2', prompt: 'Second passage-only question', choices: ['A', 'B', 'C', 'D'] },
      ],
      answerKey: [
        { questionId: 'q1', correctIndex: 0, explanation: 'Why A is correct' },
        { questionId: 'q2', correctIndex: 1, explanation: 'Why B is correct' },
      ],
    },
  };

  return `# Today's Japanese grammar lesson

Prompt version: ${GRAMMAR_PROMPT_VERSION}

You are my interactive Japanese tutor. Teach and test me on every grammar point below. Do not merely give me a worksheet: conduct the lesson conversationally, wait for each answer, correct mistakes, contrast confusing forms, and adapt the next question to my performance.

## Your first response: mandatory placement check

Before teaching or explaining anything, write exactly one numbered Japanese sentence for **every** scheduled grammar point. In each sentence, bold only the words that realize the target grammar construction. Do not reveal meanings, translations, grammar labels, whether a point is NEW or REVIEW, or any answers. After listing all sentences, ask me to translate or explain each numbered sentence and wait for my response. This diagnostic must be the entirety of your first response.

## Learner profile

- Algorithmic level estimate: **${input.levelLabel}**
- Conservative known-word count: **${input.knownWords.toLocaleString()}**
- New grammar pace: **5 points per calendar week**
- Keep example vocabulary at or below my level unless a new word is necessary and explained.

## Vocabulary anchors

${vocabulary}

If these are Anki leeches, deliberately recycle them where natural. If they are merely known words, use only the ones that fit. You may ignore awkward anchors.

## Tutor-only grammar data

${itemRows}

Do not expose the meanings, examples, labels, or notes above until after I answer the placement check.

## Lesson procedure

1. Grade the placement check separately for every learningItemId using the rubric below. If I already know a NEW point on this first attempt, set masteredOnPlacement to true and rating to EASY; the app will immediately mark that grammar point MASTERED. Do not reteach it.
2. Finish every scheduled grammar point before discussing any secondary Japanese issues. Briefly teach each remaining NEW or missed point with formation, nuance, and one natural example. For REVIEW points, explain only what the diagnostic showed was weak.
3. Test recognition and production for every point not mastered during placement, with at least one item each. Do not introduce random grammar points, unrelated translation drills, arbitrary vocabulary quizzes, or general Japanese exercises.
4. Only after all scheduled grammar work is finished, add a separate Japanese feedback phase. Explain and correct actual problems that appeared in my answers, including word choice, natural phrasing, particles, and nuance differences. Do not invent unrelated problems for this phase.
5. Track correct and total answers separately for every learningItemId. Count the placement translation and explanation as separate opportunities when both were attempted.
6. Prepare a short Japanese passage that naturally uses several scheduled points for the JSON payload only. Do not present it as another interactive exercise in this grammar session.
7. Immediately after the feedback phase, automatically return **only one JSON object** matching the shape below. Do not ask whether I want the JSON, do not wait for another request, and do not include a markdown fence or commentary around it.

## Rating rubric

- EASY: I immediately give a natural translation and an accurate explanation of meaning, formation, or nuance without help. For a NEW point known before any teaching, also set masteredOnPlacement to true so the app marks it MASTERED immediately. Otherwise set masteredOnPlacement to false.
- GOOD: I clearly understand the point but make only a minor translation, wording, or nuance error. An accurate explanation with an imperfect translation is usually GOOD.
- HARD: I recognize the point or give a partial explanation, but cannot translate it correctly, miss an important nuance, or need substantial prompting.
- AGAIN: I cannot identify or explain the point, or my answer shows a fundamental misunderstanding.

Never set masteredOnPlacement to true because I learned the point during this session; it is only for a NEW point demonstrated correctly in the initial placement response. Use the final demonstrated performance, not completion or confidence alone, for all other ratings.

## Required final JSON shape

${JSON.stringify(responseExample, null, 2)}

Rules: include exactly one grammarResults entry for every learningItemId above; preserve the learningItemId values exactly; include masteredOnPlacement for every result; correctIndex is zero-based; each answerKey questionId must match a question; each correctIndex must identify an existing choice; make the passage at least 100 characters. The app computes word count and the next SRS due date itself from each rating.
`;
}
