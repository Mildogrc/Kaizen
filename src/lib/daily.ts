import type { WeekendSkill } from './nato';

export interface DailyQueueInput {
  ankiDue: number;
  grammarReviews: number;
  grammarNew?: number;
  readingBook: { id: string; title: string } | null;
  readToday: boolean;
  weekendSkills?: WeekendSkill[];
}

export interface DailyQueueBlock {
  key: 'anki' | 'grammar' | 'read' | WeekendSkill['key'];
  title: string;
  detail: string;
  href: string;
  count: number;
  complete: boolean;
}

export function buildDailyQueue(input: DailyQueueInput): DailyQueueBlock[] {
  const queue: DailyQueueBlock[] = [{
    key: 'anki',
    title: 'Anki review',
    detail: `${input.ankiDue.toLocaleString()} cards due across all mapped decks`,
    href: '/anki',
    count: input.ankiDue,
    complete: input.ankiDue === 0,
  }];
  const grammarNew = input.grammarNew ?? 0;
  if (input.grammarReviews > 0 || grammarNew > 0) {
    const reviewDetail = `${input.grammarReviews} ${input.grammarReviews === 1 ? 'review' : 'reviews'} due`;
    const detail = input.grammarReviews > 0 && grammarNew > 0
      ? `${reviewDetail} + ${grammarNew} new points`
      : input.grammarReviews > 0
        ? reviewDetail
        : `${grammarNew} new points ready`;
    queue.push({
      key: 'grammar',
      title: 'Japanese grammar',
      detail,
      href: `/japanese/grammar?returnTo=${encodeURIComponent('/daily')}`,
      count: input.grammarReviews + grammarNew,
      complete: false,
    });
  }
  for (const weekendSkill of input.weekendSkills ?? []) {
    queue.push({
      key: weekendSkill.key,
      title: weekendSkill.title,
      detail: weekendSkill.detail,
      href: weekendSkill.href,
      count: 1,
      complete: false,
    });
  }
  queue.push({
    key: 'read',
    title: 'Read',
    detail: input.readingBook ? input.readingBook.title : 'Choose a current book',
    href: input.readingBook
      ? `/books/${input.readingBook.id}?returnTo=${encodeURIComponent('/daily')}#reading-log`
      : '/books',
    count: input.readingBook ? 1 : 0,
    complete: input.readToday,
  });
  return queue;
}
