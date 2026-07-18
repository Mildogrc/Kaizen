import { z } from 'zod';
import { speedReadingPassageInputSchema } from './grammar-coach';

export const DEFAULT_READING_WPM = 250;
export const DEFAULT_COMPREHENSION_THRESHOLD = 0.8;

export const readingPassageSchema = speedReadingPassageInputSchema.superRefine((passage, context) => {
  const questionIds = new Set(passage.questions.map((question) => question.id));
  if (questionIds.size !== passage.questions.length) {
    context.addIssue({ code: 'custom', message: 'Question IDs must be unique.', path: ['questions'] });
  }
  const answerIds = new Set<string>();
  for (const [index, answer] of passage.answerKey.entries()) {
    const question = passage.questions.find((candidate) => candidate.id === answer.questionId);
    if (!question) {
      context.addIssue({ code: 'custom', message: 'Every answer must reference a question.', path: ['answerKey', index, 'questionId'] });
    } else if (answer.correctIndex >= question.choices.length) {
      context.addIssue({ code: 'custom', message: 'correctIndex is outside the question choices.', path: ['answerKey', index, 'correctIndex'] });
    }
    if (answerIds.has(answer.questionId)) {
      context.addIssue({ code: 'custom', message: 'Each question may have only one answer.', path: ['answerKey', index, 'questionId'] });
    }
    answerIds.add(answer.questionId);
  }
  if (passage.questions.some((question) => !answerIds.has(question.id))) {
    context.addIssue({ code: 'custom', message: 'Every question must have an answer-key entry.', path: ['answerKey'] });
  }
});

export const readingSessionInputSchema = z.object({
  passageId: z.string().trim().min(1),
  mode: z.enum(['RSVP', 'PACED', 'CHUNKING', 'BENCHMARK']),
  wpm: z.number().int().min(50).max(2_000),
  chunkSize: z.number().int().min(1).max(5),
  fontSize: z.number().int().min(16).max(96),
  punctuationPause: z.boolean(),
  comprehensionThreshold: z.number().min(0.5).max(1),
  startedAt: z.string().datetime(),
  durationSec: z.number().int().min(1).max(7_200),
  responseTimeMs: z.number().int().min(0).max(7_200_000),
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
}).strict();

export type ReadingPassageInput = z.infer<typeof readingPassageSchema>;
export type ReadingSessionInput = z.infer<typeof readingSessionInputSchema>;

export function tokenizePassage(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const tokens: string[] = [];
  for (const segment of segmenter.segment(text)) {
    const value = segment.segment;
    if (/^\s+$/u.test(value)) continue;
    if (segment.isWordLike || tokens.length === 0) tokens.push(value);
    else tokens[tokens.length - 1] += value;
  }
  return tokens;
}

export function adaptiveWpm(input: {
  currentWpm: number;
  accuracy: number;
  threshold?: number;
  latestRetention?: number | null;
}): number {
  const threshold = input.threshold ?? DEFAULT_COMPREHENSION_THRESHOLD;
  const effectiveAccuracy = input.latestRetention == null
    ? input.accuracy
    : Math.min(input.accuracy, input.latestRetention);
  if (effectiveAccuracy >= threshold + 0.1) {
    return Math.min(2_000, input.currentWpm + Math.max(10, Math.round(input.currentWpm * 0.05)));
  }
  if (effectiveAccuracy < threshold) {
    return Math.max(50, input.currentWpm - Math.max(10, Math.round(input.currentWpm * 0.05)));
  }
  return input.currentWpm;
}

export function readingStreak(dates: Date[], now: Date = new Date()): { current: number; best: number } {
  const days = [...new Set(dates.map((date) => date.toISOString().slice(0, 10)))].sort();
  if (!days.length) return { current: 0, best: 0 };
  let best = 1;
  let run = 1;
  for (let index = 1; index < days.length; index++) {
    const previous = new Date(`${days[index - 1]}T12:00:00Z`);
    const current = new Date(`${days[index]}T12:00:00Z`);
    if ((current.getTime() - previous.getTime()) / 86_400_000 === 1) run++;
    else run = 1;
    best = Math.max(best, run);
  }
  const today = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const last = days.at(-1);
  if (last !== today && last !== yesterday) return { current: 0, best };

  let current = 1;
  for (let index = days.length - 1; index > 0; index--) {
    const right = new Date(`${days[index]}T12:00:00Z`);
    const left = new Date(`${days[index - 1]}T12:00:00Z`);
    if ((right.getTime() - left.getTime()) / 86_400_000 !== 1) break;
    current++;
  }
  return { current, best };
}

export function buildSpeedReadingPrompt(input: {
  category: string;
  difficulty: string;
  targetWords: number;
}): string {
  const example = {
    title: 'Descriptive title',
    topic: 'Specific topic',
    category: input.category,
    difficulty: input.difficulty,
    sourceUrl: 'https://en.wikipedia.org/wiki/Relevant_article',
    text: 'Three to six paragraphs of self-contained informational prose.',
    questions: [
      { id: 'q1', prompt: 'A question answerable only from the passage', choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'] },
      { id: 'q2', prompt: 'A second passage-only question', choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'] },
      { id: 'q3', prompt: 'A third passage-only question', choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'] },
      { id: 'q4', prompt: 'A fourth passage-only question', choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'] },
    ],
    answerKey: [
      { questionId: 'q1', correctIndex: 0, explanation: 'Brief passage-grounded explanation' },
      { questionId: 'q2', correctIndex: 1, explanation: 'Brief passage-grounded explanation' },
      { questionId: 'q3', correctIndex: 2, explanation: 'Brief passage-grounded explanation' },
      { questionId: 'q4', correctIndex: 3, explanation: 'Brief passage-grounded explanation' },
    ],
  };
  return `# Speed-reading passage generation

Create one self-contained educational reading exercise for a speed-reading trainer.

Requirements:
1. Select a random informational topic in the category "${input.category}" at "${input.difficulty}" difficulty.
2. Base factual claims on a reliable public source, preferably Wikipedia, and include the direct source URL.
3. Write approximately ${input.targetWords} words in three to six short paragraphs. Paraphrase; do not copy long source passages.
4. Write 4–6 multiple-choice comprehension questions based only on the passage. Include plausible distractors.
5. Provide exactly one answer-key entry per question, with a zero-based correctIndex and a brief explanation.
6. Do not rely on images, tables, equations, or outside knowledge to answer.
7. Return only one JSON object, with no markdown fence or commentary.

Required shape:
${JSON.stringify(example, null, 2)}
`;
}
