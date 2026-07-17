import { describe, expect, it } from 'vitest';
import { buildDailyQueue, newCardCap, type QueueInput } from '../src/lib/daily';

const input: QueueInput = {
  inAppDue: [
    { courseName: 'Mathematics', tab: 'MATH', count: 12 },
    { courseName: 'NATO Alphabet', tab: 'SKILLS', count: 5 },
  ],
  inAppNew: [{ courseName: 'Mathematics', tab: 'MATH', count: 30 }],
  ankiDue: [{ courseName: 'Chinese', tab: 'CHINESE', count: 226 }],
  openMistakes: [{ courseName: 'Mathematics', tab: 'MATH', count: 3 }],
  rememberNotes: 2,
};

describe('buildDailyQueue', () => {
  it('balanced mode: anki first, then reviews, capped new cards, mistakes, books', () => {
    const queue = buildDailyQueue(input, 'balanced');
    expect(queue.map((b) => b.key)).toEqual(['anki', 'due', 'new', 'mistakes', 'books']);
    expect(queue[2].count).toBe(20); // 30 available, capped at 20
    expect(queue[0].emphasis).toBe(true);
  });

  it('review-heavy mode drops the new-cards block entirely', () => {
    const queue = buildDailyQueue(input, 'review-heavy');
    expect(queue.find((b) => b.key === 'new')).toBeUndefined();
    expect(queue[0].key).toBe('anki');
  });

  it('mistake-cleanup puts mistakes first', () => {
    expect(buildDailyQueue(input, 'mistake-cleanup')[0].key).toBe('mistakes');
  });

  it('new-content-heavy leads with a 40-card cap', () => {
    const queue = buildDailyQueue(input, 'new-content-heavy');
    expect(queue[0].key).toBe('new');
    expect(queue[0].count).toBe(30); // all 30 available, under the 40 cap
    expect(newCardCap('new-content-heavy')).toBe(40);
  });

  it('math-focused puts math blocks first and the rest after', () => {
    const queue = buildDailyQueue(input, 'math-focused');
    const keys = queue.map((b) => b.key);
    expect(keys.indexOf('due-focus')).toBeLessThan(keys.indexOf('anki-rest'));
    const focusBlock = queue.find((b) => b.key === 'due-focus')!;
    expect(focusBlock.count).toBe(12); // math only
    expect(focusBlock.emphasis).toBe(true);
    const restAnki = queue.find((b) => b.key === 'anki-rest')!;
    expect(restAnki.count).toBe(226);
    expect(restAnki.emphasis).toBe(false);
  });

  it('chinese-focused leads with the Anki block for Chinese', () => {
    const queue = buildDailyQueue(input, 'chinese-focused');
    expect(queue[0].key).toBe('anki-focus');
    expect(queue[0].count).toBe(226);
  });

  it('omits empty blocks', () => {
    const empty = buildDailyQueue(
      { inAppDue: [], inAppNew: [], ankiDue: [], openMistakes: [], rememberNotes: 0 },
      'balanced',
    );
    expect(empty).toHaveLength(0);
  });
});
