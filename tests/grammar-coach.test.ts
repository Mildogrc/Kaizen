import { describe, expect, it } from 'vitest';
import {
  buildGrammarLessonPrompt,
  grammarLessonResponseSchema,
  japaneseLevelFromKnownWords,
  newGrammarDueToday,
  parseJsonText,
  scheduleGrammarResult,
  selectGrammarQueue,
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
});

describe('grammar lesson contract', () => {
  it('derives the learner level from known words', () => {
    expect(japaneseLevelFromKnownWords(1_250)).toContain('upper beginner');
    expect(japaneseLevelFromKnownWords(4_000)).toContain('intermediate');
  });

  it('builds a self-contained interactive prompt', () => {
    const prompt = buildGrammarLessonPrompt({
      lessonId: 'lesson-1',
      levelLabel: japaneseLevelFromKnownWords(1_250),
      knownWords: 1_250,
      items: [{ learningItemId: 'grammar-1', kind: 'new', pattern: '～は～です', meaning: 'A is B', jlptLevel: 'N5', examples: [] }],
      vocabulary: [{ source: 'known-word', term: '猫' }],
    });
    expect(prompt).toContain('interactive Japanese tutor');
    expect(prompt).toContain('grammar-placement-v3');
    expect(prompt).toContain('mandatory placement check');
    expect(prompt).toContain('bold only the words');
    expect(prompt).toContain('An accurate explanation with an imperfect translation is usually GOOD');
    expect(prompt).toContain('immediately mark that grammar point MASTERED');
    expect(prompt).toContain('Do not ask whether I want the JSON');
    expect(prompt).toContain('Do not introduce random grammar points');
    expect(prompt).toContain('grammar-1');
    expect(prompt).toContain('speedReadingPassage');
  });

  it('accepts fenced valid lesson JSON', () => {
    const parsed = parseJsonText('```json\n{"lessonId":"lesson-1","grammarResults":[{"learningItemId":"grammar-1","rating":"GOOD","masteredOnPlacement":false,"correct":2,"total":3}]}\n```');
    expect(grammarLessonResponseSchema.parse(parsed).lessonId).toBe('lesson-1');
  });
});
