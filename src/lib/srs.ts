// SM-2-style spaced repetition scheduler. Pure functions so the logic is
// testable independent of the database. Works on top of ReviewRecord fields;
// honors ease/interval imported from Anki.

export type Rating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';

export interface SrsState {
  ease: number; // 2.5 default, floor 1.3
  intervalDays: number; // 0 while learning
  repetitions: number;
  lapseCount: number;
  isLeech: boolean;
}

export interface SrsResult extends SrsState {
  dueAt: Date;
  maturity: 'NEW' | 'LEARNING' | 'YOUNG' | 'MATURE';
}

const MIN_EASE = 1.3;
const LEECH_LAPSES = 8;
const LEARN_AGAIN_MINUTES = 10;
const GRADUATE_DAYS = 1;
const EASY_GRADUATE_DAYS = 4;
const MATURE_DAYS = 21;

function maturityFor(intervalDays: number): SrsResult['maturity'] {
  if (intervalDays >= MATURE_DAYS) return 'MATURE';
  if (intervalDays >= 1) return 'YOUNG';
  return 'LEARNING';
}

function addMinutes(d: Date, m: number) {
  return new Date(d.getTime() + m * 60_000);
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Apply a rating to the current state, returning the next state. */
export function rate(state: SrsState, rating: Rating, now: Date = new Date()): SrsResult {
  const s = { ...state };
  const learning = s.intervalDays < 1;

  switch (rating) {
    case 'AGAIN': {
      // Lapse if the card had graduated; relearn in 10 minutes.
      if (!learning) s.lapseCount += 1;
      s.repetitions = 0;
      s.ease = Math.max(MIN_EASE, s.ease - 0.2);
      s.intervalDays = 0;
      s.isLeech = s.isLeech || s.lapseCount >= LEECH_LAPSES;
      return { ...s, dueAt: addMinutes(now, LEARN_AGAIN_MINUTES), maturity: 'LEARNING' };
    }
    case 'HARD': {
      s.ease = Math.max(MIN_EASE, s.ease - 0.15);
      s.repetitions += 1;
      if (learning) {
        // Stay in learning; see it again soon.
        return { ...s, dueAt: addMinutes(now, LEARN_AGAIN_MINUTES), maturity: 'LEARNING' };
      }
      s.intervalDays = Math.max(1, Math.round(s.intervalDays * 1.2));
      return { ...s, dueAt: addDays(now, s.intervalDays), maturity: maturityFor(s.intervalDays) };
    }
    case 'GOOD': {
      s.repetitions += 1;
      if (learning) {
        // Two learning steps: 10 minutes, then graduate to 1 day.
        if (s.repetitions < 2) {
          return { ...s, dueAt: addMinutes(now, LEARN_AGAIN_MINUTES), maturity: 'LEARNING' };
        }
        s.intervalDays = GRADUATE_DAYS;
      } else {
        s.intervalDays = Math.max(s.intervalDays + 1, Math.round(s.intervalDays * s.ease));
      }
      return { ...s, dueAt: addDays(now, s.intervalDays), maturity: maturityFor(s.intervalDays) };
    }
    case 'EASY': {
      s.repetitions += 1;
      s.ease += 0.15;
      s.intervalDays = learning
        ? EASY_GRADUATE_DAYS
        : Math.max(s.intervalDays + 1, Math.round(s.intervalDays * s.ease * 1.3));
      return { ...s, dueAt: addDays(now, s.intervalDays), maturity: maturityFor(s.intervalDays) };
    }
  }
}
