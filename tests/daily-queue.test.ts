import { describe, expect, it } from 'vitest';
import { buildDailyQueue } from '../src/lib/daily';

describe('buildDailyQueue', () => {
  it('creates Anki, grammar, and reading blocks without in-app reviews', () => {
    const queue = buildDailyQueue({
      ankiDue: 226,
      grammarReviews: 4,
      readingBook: { id: 'book-1', title: 'A Book' },
      readToday: false,
    });
    expect(queue.map((block) => block.title)).toEqual(['Anki review', 'Japanese grammar', 'Read']);
    expect(queue[0].count).toBe(226);
    expect(queue[1].count).toBe(4);
    expect(queue[1].detail).toBe('4 reviews due');
    expect(queue[1].href).toContain('returnTo=%2Fdaily');
    expect(queue[2].href).toContain('returnTo=%2Fdaily');
    expect(queue.some((block) => block.title === 'In-app review')).toBe(false);
  });

  it('uses singular wording for one grammar review', () => {
    const queue = buildDailyQueue({ ankiDue: 0, grammarReviews: 1, readingBook: null, readToday: false });
    expect(queue[1].detail).toBe('1 review due');
  });

  it('hides grammar when no reviews or new points are due', () => {
    const queue = buildDailyQueue({ ankiDue: 0, grammarReviews: 0, readingBook: null, readToday: true });
    expect(queue.map((block) => block.key)).toEqual(['anki', 'read']);
    expect(queue.every((block) => block.complete)).toBe(true);
  });

  it('shows a weekly new-grammar batch without claiming reviews are due', () => {
    const queue = buildDailyQueue({ ankiDue: 0, grammarReviews: 0, grammarNew: 5, readingBook: null, readToday: false });
    const grammar = queue.find((block) => block.key === 'grammar');
    expect(grammar?.detail).toBe('5 new points ready');
    expect(grammar?.count).toBe(5);
  });

  it('adds Saturday skills before reading', () => {
    const queue = buildDailyQueue({
      ankiDue: 0,
      grammarReviews: 0,
      readingBook: null,
      readToday: false,
      weekendSkills: [
        { key: 'geoguessr', title: 'GeoGuessr', detail: 'Saturday practice', href: 'https://www.geoguessr.com/analytics' },
        { key: 'nato', title: 'NATO recall', detail: 'Saturday recall', href: '/nato' },
      ],
    });
    expect(queue.slice(1, 3).map((block) => block.key)).toEqual(['geoguessr', 'nato']);
    expect(queue.at(-1)?.key).toBe('read');
  });
});
