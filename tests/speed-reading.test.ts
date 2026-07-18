import { describe, expect, it } from 'vitest';
import {
  adaptiveWpm,
  buildSpeedReadingPrompt,
  readingPassageSchema,
  readingStreak,
  tokenizePassage,
} from '../src/lib/speed-reading';

describe('speed reading adaptation', () => {
  it('raises speed only above the comprehension margin', () => {
    expect(adaptiveWpm({ currentWpm: 300, accuracy: 0.95 })).toBeGreaterThan(300);
    expect(adaptiveWpm({ currentWpm: 300, accuracy: 0.82 })).toBe(300);
    expect(adaptiveWpm({ currentWpm: 300, accuracy: 0.7 })).toBeLessThan(300);
  });

  it('uses delayed retention when available', () => {
    expect(adaptiveWpm({ currentWpm: 300, accuracy: 1, latestRetention: 0.6 })).toBeLessThan(300);
  });

  it('tokenizes English and unspaced Japanese text', () => {
    expect(tokenizePassage('One short sentence.')).toEqual(['One', 'short', 'sentence.']);
    expect(tokenizePassage('猫が走る。').length).toBeGreaterThan(1);
  });

  it('computes current and best daily streaks', () => {
    const dates = [new Date('2026-07-15T12:00:00Z'), new Date('2026-07-16T12:00:00Z'), new Date('2026-07-17T12:00:00Z')];
    expect(readingStreak(dates, new Date('2026-07-17T15:00:00Z'))).toEqual({ current: 3, best: 3 });
  });
});

describe('passage contract', () => {
  it('rejects answer indexes outside the choices', () => {
    const result = readingPassageSchema.safeParse({
      title: 'Test', topic: 'Science', category: 'science', difficulty: 'beginner',
      text: 'A sufficiently long passage '.repeat(10),
      questions: [{ id: 'q1', prompt: 'Question?', choices: ['A', 'B'] }],
      answerKey: [{ questionId: 'q1', correctIndex: 3, explanation: 'No.' }],
    });
    expect(result.success).toBe(false);
  });

  it('builds a source-grounded generation prompt', () => {
    const prompt = buildSpeedReadingPrompt({ category: 'biology', difficulty: 'intermediate', targetWords: 400 });
    expect(prompt).toContain('Wikipedia');
    expect(prompt).toContain('400 words');
    expect(prompt).toContain('answer-key');
  });
});
