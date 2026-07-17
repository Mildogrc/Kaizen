// Analytics over Anki snapshots and review logs. Pure functions on plain row
// shapes — callers map Prisma rows in, tests use synthetic fixtures.

export interface SnapshotRow {
  ankiCardId: string;
  /** deck mapping this card belongs to (set by the DB adapter) */
  mappingId?: string;
  front: string;
  back: string;
  state: 'NEW' | 'LEARNING' | 'YOUNG' | 'MATURE' | 'SUSPENDED' | 'BURIED';
  intervalDays: number;
  ease: number;
  dueAt: Date | null;
  reps: number;
  lapses: number;
  isLeech: boolean;
}

export interface LogRow {
  ankiCardId: string;
  reviewedAt: Date;
  rating: number; // 1=again 2=hard 3=good 4=easy
  intervalBeforeDays: number;
  intervalAfterDays: number;
  timeMs: number;
}

const DAY_MS = 86_400_000;
const MATURE_DAYS = 21;

export const dayKey = (d: Date) => {
  const local = new Date(d);
  local.setHours(0, 0, 0, 0);
  return local.toISOString().slice(0, 10);
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// ------------------------------------------------------------------ Activity

export interface DayActivity {
  date: string; // YYYY-MM-DD
  reviews: number;
  minutes: number;
}

/** Reviews per calendar day for the trailing `days` window (inclusive of today). */
export function reviewsPerDay(logs: LogRow[], days: number, now: Date = new Date()): DayActivity[] {
  const byDay = new Map<string, { reviews: number; ms: number }>();
  for (const log of logs) {
    const key = dayKey(log.reviewedAt);
    const entry = byDay.get(key) ?? { reviews: 0, ms: 0 };
    entry.reviews += 1;
    entry.ms += log.timeMs;
    byDay.set(key, entry);
  }
  const out: DayActivity[] = [];
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * DAY_MS);
    const key = dayKey(date);
    const entry = byDay.get(key);
    out.push({ date: key, reviews: entry?.reviews ?? 0, minutes: Math.round((entry?.ms ?? 0) / 60_000) });
  }
  return out;
}

/** Current streak (today counts if reviewed; else from yesterday) and best streak. */
export function streaks(logs: LogRow[], now: Date = new Date()): { current: number; best: number } {
  const days = new Set(logs.map((l) => dayKey(l.reviewedAt)));
  let current = 0;
  const cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor.setTime(cursor.getTime() - DAY_MS);
  while (days.has(dayKey(cursor))) {
    current++;
    cursor.setTime(cursor.getTime() - DAY_MS);
  }
  // Best streak over all days.
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sorted) {
    if (prev !== null && new Date(key).getTime() - new Date(prev).getTime() === DAY_MS) run += 1;
    else run = 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best };
}

// ----------------------------------------------------------------- Retention

export interface RetentionStats {
  overall: number | null; // pass rate 0..1, null when no data
  young: number | null;
  mature: number | null;
  lapses: number;
  reviewCount: number;
}

/** Pass rate (rating > 1) over review-stage answers (interval ≥ 1 day before). */
export function retention(logs: LogRow[]): RetentionStats {
  const reviewLogs = logs.filter((l) => l.intervalBeforeDays >= 1);
  const split = (subset: LogRow[]) =>
    subset.length === 0 ? null : subset.filter((l) => l.rating > 1).length / subset.length;
  const young = reviewLogs.filter((l) => l.intervalBeforeDays < MATURE_DAYS);
  const mature = reviewLogs.filter((l) => l.intervalBeforeDays >= MATURE_DAYS);
  return {
    overall: split(reviewLogs),
    young: split(young),
    mature: split(mature),
    lapses: reviewLogs.filter((l) => l.rating === 1).length,
    reviewCount: reviewLogs.length,
  };
}

// ------------------------------------------------------------------ Forecast

export interface ForecastDay {
  date: string;
  due: number;
}

export interface Forecast {
  overdue: number;
  days: ForecastDay[];
}

/** Cards due per day for the next `days` days, plus the overdue backlog. */
export function forecast(snapshots: SnapshotRow[], days: number, now: Date = new Date()): Forecast {
  const today = startOfDay(now);
  const scheduled = snapshots.filter(
    (s) => s.dueAt !== null && (s.state === 'YOUNG' || s.state === 'MATURE' || s.state === 'LEARNING'),
  );
  const overdue = scheduled.filter((s) => s.dueAt! < today).length;
  const buckets = new Map<string, number>();
  for (const s of scheduled) {
    if (s.dueAt! < today) continue;
    const key = dayKey(s.dueAt!);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const out: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const key = dayKey(new Date(today.getTime() + i * DAY_MS));
    out.push({ date: key, due: buckets.get(key) ?? 0 });
  }
  // Overdue cards land on today in practice.
  if (out.length > 0) out[0].due += overdue;
  return { overdue, days: out };
}

// -------------------------------------------------------------------- Health

export interface HealthStats {
  states: Record<SnapshotRow['state'], number>;
  easeHistogram: { label: string; count: number }[];
  intervalBuckets: { label: string; count: number }[];
}

export function health(snapshots: SnapshotRow[]): HealthStats {
  const states: HealthStats['states'] = { NEW: 0, LEARNING: 0, YOUNG: 0, MATURE: 0, SUSPENDED: 0, BURIED: 0 };
  for (const s of snapshots) states[s.state] += 1;

  const easeBounds = [1.3, 1.7, 2.1, 2.5, 2.9];
  const easeHistogram = easeBounds.map((lo, i) => {
    const hi = easeBounds[i + 1] ?? Infinity;
    const label = hi === Infinity ? `${lo.toFixed(1)}+` : `${lo.toFixed(1)}–${hi.toFixed(1)}`;
    const graded = snapshots.filter((s) => s.state === 'YOUNG' || s.state === 'MATURE');
    return { label, count: graded.filter((s) => s.ease >= lo && s.ease < hi).length };
  });

  const intervalBounds: [string, number, number][] = [
    ['<1w', 1, 7], ['1w–1m', 7, 30], ['1–3m', 30, 90], ['3m–1y', 90, 365], ['1y+', 365, Infinity],
  ];
  const scheduled = snapshots.filter((s) => s.intervalDays >= 1);
  const intervalBuckets = intervalBounds.map(([label, lo, hi]) => ({
    label,
    count: scheduled.filter((s) => s.intervalDays >= lo && s.intervalDays < hi).length,
  }));

  return { states, easeHistogram, intervalBuckets };
}

// --------------------------------------------------------------- Projections

export interface Projection {
  label: string;
  detail: string;
  date: string | null; // YYYY-MM-DD, null = not estimable
  confidence: 'low' | 'ok';
}

const PACE_WINDOW_DAYS = 30;
const MIN_ACTIVE_DAYS = 7;

/** Average per-day pace of an event count over the trailing window. */
function pace(events: Date[], now: Date): { perDay: number; activeDays: number } {
  const cutoff = startOfDay(now).getTime() - PACE_WINDOW_DAYS * DAY_MS;
  const recent = events.filter((d) => d.getTime() >= cutoff);
  const activeDays = new Set(recent.map((d) => dayKey(d))).size;
  return { perDay: recent.length / PACE_WINDOW_DAYS, activeDays };
}

function projectDate(remaining: number, perDay: number, now: Date): string | null {
  if (perDay <= 0 || remaining <= 0) return remaining <= 0 ? dayKey(now) : null;
  return dayKey(new Date(startOfDay(now).getTime() + Math.ceil(remaining / perDay) * DAY_MS));
}

/**
 * Forward-looking estimates from recent pace. Clearly heuristic: intro pace =
 * first-ever reviews per day; maturation pace = young→mature crossings/day.
 */
export function projections(
  snapshots: SnapshotRow[],
  logs: LogRow[],
  goal: { title: string; targetValue: number; currentValue?: number } | null = null,
  now: Date = new Date(),
): Projection[] {
  const out: Projection[] = [];

  // First review of each card ≈ introduction event.
  const firstSeen = new Map<string, Date>();
  for (const log of [...logs].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime())) {
    if (!firstSeen.has(log.ankiCardId)) firstSeen.set(log.ankiCardId, log.reviewedAt);
  }
  const intro = pace([...firstSeen.values()], now);
  const newRemaining = snapshots.filter((s) => s.state === 'NEW').length;
  const introConfidence = intro.activeDays >= MIN_ACTIVE_DAYS ? 'ok' : 'low';
  out.push({
    label: 'All new cards introduced',
    detail: `${newRemaining} new cards left at ~${(intro.perDay).toFixed(1)}/day (last ${PACE_WINDOW_DAYS}d)`,
    date: projectDate(newRemaining, intro.perDay, now),
    confidence: introConfidence,
  });

  // Young→mature crossings.
  const maturedEvents = logs
    .filter((l) => l.intervalBeforeDays < MATURE_DAYS && l.intervalAfterDays >= MATURE_DAYS)
    .map((l) => l.reviewedAt);
  const maturePace = pace(maturedEvents, now);
  const matureCount = snapshots.filter((s) => s.state === 'MATURE').length;
  const immature = snapshots.filter((s) => s.state !== 'MATURE' && s.state !== 'SUSPENDED' && s.state !== 'BURIED').length;
  out.push({
    label: 'Whole deck mature',
    detail: `${immature} cards not yet mature at ~${maturePace.perDay.toFixed(1)} maturing/day`,
    date: projectDate(immature, maturePace.perDay, now),
    confidence: maturePace.activeDays >= MIN_ACTIVE_DAYS ? 'ok' : 'low',
  });

  if (goal && goal.targetValue > 0) {
    const current = goal.currentValue ?? matureCount;
    const remaining = goal.targetValue - current;
    out.push({
      label: `Goal: ${goal.title}`,
      detail: `${Math.max(0, remaining)} to go (counting mature cards) at ~${maturePace.perDay.toFixed(1)}/day`,
      date: projectDate(remaining, maturePace.perDay, now),
      confidence: maturePace.activeDays >= MIN_ACTIVE_DAYS ? 'ok' : 'low',
    });
  }

  return out;
}

// ------------------------------------------------------------------- Leeches

export function leeches(snapshots: SnapshotRow[]): SnapshotRow[] {
  return snapshots
    .filter((s) => s.isLeech)
    .sort((a, b) => b.lapses - a.lapses);
}
