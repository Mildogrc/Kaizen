export const NATO_CODE_WORDS: Record<string, string> = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
  X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

const TRAINING_WORDS = [
  'JACKDAW', 'FJORD', 'QUIZ', 'VEXING', 'WHISKEY', 'ZEPHYR', 'BOXCAR',
  'JUMBLE', 'PYTHON', 'GALAXY', 'VECTOR', 'BRONZE', 'FLIGHT', 'SQUAD',
  'KITTEN', 'MANGO', 'CIPHER', 'DYNAMIC', 'QUARTZ', 'FOXHOUND',
  'BLUEJAY', 'NETWORK', 'COMPASS', 'JIGSAW', 'VORTEX', 'BACKFLIP',
];

export interface NatoAttempt {
  letter: string;
  expected: string;
  typed: string;
  correct: boolean;
  timeMs: number;
}

export interface NatoSessionStats {
  word: string;
  attempts: NatoAttempt[];
  accuracy: number;
  averageRecallMs: number;
  totalTimeMs: number;
  nextIntervalDays: number;
}

export interface NatoLetterMetric {
  letter: string;
  attempts: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  lastSeenAt: Date | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function parseNatoSessionStats(value: unknown): NatoSessionStats | null {
  const row = asRecord(value);
  if (typeof row.word !== 'string' || !Array.isArray(row.attempts)) return null;
  const attempts = row.attempts.flatMap((value) => {
    const attempt = asRecord(value);
    const letter = String(attempt.letter ?? '').toUpperCase();
    if (!NATO_CODE_WORDS[letter]) return [];
    return [{
      letter,
      expected: NATO_CODE_WORDS[letter],
      typed: String(attempt.typed ?? ''),
      correct: Boolean(attempt.correct),
      timeMs: Math.max(0, Number(attempt.timeMs) || 0),
    }];
  });
  if (attempts.length === 0) return null;
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const totalTimeMs = attempts.reduce((sum, attempt) => sum + attempt.timeMs, 0);
  const accuracy = correct / attempts.length;
  const averageRecallMs = totalTimeMs / attempts.length;
  return {
    word: row.word.toUpperCase(),
    attempts,
    accuracy,
    averageRecallMs,
    totalTimeMs,
    nextIntervalDays: natoIntervalDays({ accuracy, averageRecallMs }),
  };
}

export function natoIntervalDays({ accuracy, averageRecallMs }: { accuracy: number; averageRecallMs: number }): number {
  if (accuracy < 0.85 || averageRecallMs > 3_000) return 7;
  if (accuracy < 0.95 || averageRecallMs > 1_800) return 14;
  return 28;
}

export function analyzeNatoSessions(sessions: { date: Date; stats: unknown }[]) {
  const byLetter = new Map<string, NatoLetterMetric>();
  const parsed = sessions.flatMap((session) => {
    const stats = parseNatoSessionStats(session.stats);
    return stats ? [{ date: session.date, stats }] : [];
  });
  for (const letter of Object.keys(NATO_CODE_WORDS)) {
    byLetter.set(letter, { letter, attempts: 0, correct: 0, accuracy: 0, averageMs: 0, lastSeenAt: null });
  }
  for (const session of parsed) {
    for (const attempt of session.stats.attempts) {
      const metric = byLetter.get(attempt.letter)!;
      metric.averageMs = ((metric.averageMs * metric.attempts) + attempt.timeMs) / (metric.attempts + 1);
      metric.attempts++;
      if (attempt.correct) metric.correct++;
      metric.accuracy = metric.correct / metric.attempts;
      if (!metric.lastSeenAt || session.date > metric.lastSeenAt) metric.lastSeenAt = session.date;
    }
  }
  const totalAttempts = parsed.reduce((sum, session) => sum + session.stats.attempts.length, 0);
  const correctAttempts = parsed.reduce((sum, session) => sum + session.stats.attempts.filter((attempt) => attempt.correct).length, 0);
  const totalTimeMs = parsed.reduce((sum, session) => sum + session.stats.totalTimeMs, 0);
  const last = parsed.at(-1) ?? null;
  const nextDueAt = last ? new Date(last.date.getTime() + last.stats.nextIntervalDays * 86_400_000) : null;
  return {
    sessions: parsed.length,
    totalAttempts,
    accuracy: totalAttempts ? correctAttempts / totalAttempts : null,
    averageRecallMs: totalAttempts ? totalTimeMs / totalAttempts : null,
    metrics: [...byLetter.values()],
    lastSessionAt: last?.date ?? null,
    nextDueAt,
  };
}

function weakness(metric: NatoLetterMetric | undefined): number {
  if (!metric || metric.attempts === 0) return 4_000;
  return metric.averageMs + (1 - metric.accuracy) * 5_000;
}

export function selectNatoWord(metrics: NatoLetterMetric[], seed: number): string {
  const byLetter = new Map(metrics.map((metric) => [metric.letter, metric]));
  const scored = TRAINING_WORDS.map((word, index) => ({
    word,
    index,
    score: word.split('').reduce((sum, letter) => sum + weakness(byLetter.get(letter)), 0) / word.length,
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const top = scored.slice(0, Math.min(5, scored.length));
  return top[Math.abs(seed) % top.length].word;
}

export type WeekendSkill = { key: 'geoguessr' | 'nato' | 'typing'; title: string; detail: string; href: string };

export function weekendSkills(date: Date, nextNatoDueAt: Date | null): WeekendSkill[] {
  const natoDue = nextNatoDueAt === null || nextNatoDueAt <= date;
  if (date.getDay() === 6) {
    return [
      { key: 'geoguessr', title: 'GeoGuessr', detail: 'Saturday weekly practice and analytics', href: 'https://www.geoguessr.com/analytics' },
      ...(natoDue ? [{ key: 'nato' as const, title: 'NATO recall', detail: 'Adaptive Saturday session for slow or missed letters', href: '/nato' }] : []),
    ];
  }
  if (date.getDay() === 0 && !natoDue) {
    return [{ key: 'typing', title: 'Typing practice', detail: 'NATO was not due Saturday · practice on Monkeytype', href: 'https://monkeytype.com/' }];
  }
  return [];
}
