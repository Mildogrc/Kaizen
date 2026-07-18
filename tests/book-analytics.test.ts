import { describe, expect, it } from 'vitest';
import { bookReadingActivity } from '../src/lib/book-analytics';

describe('book reading activity', () => {
  it('aggregates pages by local calendar day across a trailing year', () => {
    const activity = bookReadingActivity([
      { readAt: new Date('2026-07-16T08:00:00'), pagesRead: 12 },
      { readAt: new Date('2026-07-16T20:00:00'), pagesRead: 8 },
      { readAt: new Date('2026-07-17T12:00:00'), pagesRead: 5 },
    ], new Date('2026-07-17T18:00:00'));

    expect(activity).toHaveLength(365);
    expect(activity.at(-2)).toEqual({ date: '2026-07-16', reviews: 20 });
    expect(activity.at(-1)).toEqual({ date: '2026-07-17', reviews: 5 });
  });
});
