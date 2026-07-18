export interface BookActivitySession {
  readAt: Date;
  pagesRead: number;
}

function dayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function bookReadingActivity(
  sessions: BookActivitySession[],
  now: Date = new Date(),
): { date: string; reviews: number }[] {
  const pagesByDay = new Map<string, number>();
  for (const session of sessions) {
    const key = dayKey(session.readAt);
    pagesByDay.set(key, (pagesByDay.get(key) ?? 0) + Math.max(0, session.pagesRead));
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (364 - index));
    const key = dayKey(date);
    return { date: key, reviews: pagesByDay.get(key) ?? 0 };
  });
}
