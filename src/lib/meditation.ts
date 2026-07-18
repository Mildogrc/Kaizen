export interface MeditationSessionInput {
  date: Date;
  durationMin: number | null;
}

export interface MeditationAnalytics {
  totalDays: number;
  totalMinutes: number;
  averageMinutes: number | null;
  currentStreak: number;
  bestStreak: number;
  daysLast30: number;
  consistencyLast30: number;
  daysThisWeek: number;
  activity365: { date: string; reviews: number }[];
  minutesTrend: { label: string; value: number; tooltip: string }[];
  monthlyDays: { label: string; value: number; tooltip: string }[];
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function dayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function daysApart(left: string, right: string): number {
  const ordinal = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
  };
  return ordinal(right) - ordinal(left);
}

export function analyzeMeditation(
  sessions: MeditationSessionInput[],
  defaultMinutes: number,
  now: Date = new Date(),
): MeditationAnalytics {
  const minutesByDay = new Map<string, number>();
  for (const session of sessions) {
    const key = dayKey(session.date);
    const minutes = session.durationMin && session.durationMin > 0 ? session.durationMin : defaultMinutes;
    minutesByDay.set(key, Math.max(minutesByDay.get(key) ?? 0, minutes));
  }

  const practicedDays = [...minutesByDay.keys()].sort();
  let bestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of practicedDays) {
    run = previous && daysApart(previous, key) === 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    previous = key;
  }

  const today = startOfDay(now);
  const todayKey = dayKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const latest = practicedDays.at(-1);
  let currentStreak = latest === todayKey || latest === dayKey(yesterday) ? 1 : 0;
  if (currentStreak) {
    for (let index = practicedDays.length - 1; index > 0; index--) {
      if (daysApart(practicedDays[index - 1], practicedDays[index]) !== 1) break;
      currentStreak++;
    }
  }

  const activity365: { date: string; reviews: number }[] = [];
  for (let offset = 364; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = dayKey(date);
    activity365.push({ date: key, reviews: minutesByDay.has(key) ? 1 : 0 });
  }
  const daysLast30 = activity365.slice(-30).reduce((sum, day) => sum + day.reviews, 0);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekStartKey = dayKey(weekStart);
  const daysThisWeek = practicedDays.filter((key) => key >= weekStartKey && key <= todayKey).length;

  const monthlyDays: MeditationAnalytics['monthlyDays'] = [];
  for (let offset = 11; offset >= 0; offset--) {
    const month = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const value = practicedDays.filter((key) => key.startsWith(prefix)).length;
    const label = month.toLocaleString('en', { month: 'short' });
    monthlyDays.push({ label, value, tooltip: `${label} ${month.getFullYear()}: ${value} meditation days` });
  }

  const totalMinutes = [...minutesByDay.values()].reduce((sum, minutes) => sum + minutes, 0);
  return {
    totalDays: practicedDays.length,
    totalMinutes,
    averageMinutes: practicedDays.length ? totalMinutes / practicedDays.length : null,
    currentStreak,
    bestStreak,
    daysLast30,
    consistencyLast30: daysLast30 / 30,
    daysThisWeek,
    activity365,
    minutesTrend: practicedDays.slice(-30).map((key) => ({ label: key.slice(5), value: minutesByDay.get(key) ?? 0, tooltip: `${key}: ${minutesByDay.get(key) ?? 0} minutes` })),
    monthlyDays,
  };
}
