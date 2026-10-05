import type { Rating } from './srs';

export interface GrammarAnalyticsProgressRow {
  status: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  dueAt: Date;
  totalCorrect: number;
  totalQuestions: number;
}

export interface GrammarAnalyticsLessonRow {
  completedAt: Date | null;
  response: unknown;
}

const RATINGS: Rating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

function dayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function grammarResults(response: unknown): Array<{ rating: Rating }> {
  if (!response || typeof response !== 'object') return [];
  const results = (response as Record<string, unknown>).grammarResults;
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    if (!result || typeof result !== 'object') return [];
    const rating = String((result as Record<string, unknown>).rating) as Rating;
    return RATINGS.includes(rating) ? [{ rating }] : [];
  });
}

export function analyzeGrammarLearning(
  progress: GrammarAnalyticsProgressRow[],
  lessons: GrammarAnalyticsLessonRow[],
  importedPassages: number,
  now: Date = new Date(),
) {
  const completed = lessons.flatMap((lesson) => {
    const results = grammarResults(lesson.response);
    return lesson.completedAt && results.length ? [{ completedAt: lesson.completedAt, results }] : [];
  });
  const totalCorrect = progress.reduce((sum, row) => sum + row.totalCorrect, 0);
  const totalQuestions = progress.reduce((sum, row) => sum + row.totalQuestions, 0);
  const ratingCounts = Object.fromEntries(RATINGS.map((rating) => [rating, 0])) as Record<Rating, number>;
  for (const lesson of completed) {
    for (const result of lesson.results) ratingCounts[result.rating]++;
  }

  const lessonDays = new Set(completed.map((lesson) => dayKey(lesson.completedAt)));
  const cursor = startOfDay(now);
  if (!lessonDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let currentStreak = 0;
  while (lessonDays.has(dayKey(cursor))) {
    currentStreak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const currentWeek = startOfWeek(now);
  const weeklyProgress = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(currentWeek);
    start.setDate(start.getDate() - (7 - index) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const rows = completed.filter((lesson) => lesson.completedAt >= start && lesson.completedAt < end);
    const points = rows.reduce((sum, lesson) => sum + lesson.results.length, 0);
    return {
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      value: points,
      tooltip: `${start.toLocaleDateString()}: ${points} grammar results across ${rows.length} ${rows.length === 1 ? 'lesson' : 'lessons'}`,
    };
  });

  return {
    completedLessons: completed.length,
    lessonsToday: completed.filter((lesson) => dayKey(lesson.completedAt) === dayKey(now)).length,
    totalCorrect,
    totalQuestions,
    accuracy: totalQuestions ? totalCorrect / totalQuestions : null,
    mastered: progress.filter((row) => row.status === 'MASTERED').length,
    due: progress.filter((row) => row.status !== 'NEW' && row.dueAt <= now).length,
    currentStreak,
    importedPassages,
    ratingDistribution: RATINGS.map((rating) => ({
      label: rating === 'EASY' ? 'Perfect' : rating === 'HARD' ? 'Hard (legacy)' : rating.charAt(0) + rating.slice(1).toLowerCase(),
      value: ratingCounts[rating],
      tooltip: `${rating}: ${ratingCounts[rating]} results`,
    })),
    weeklyProgress,
  };
}
