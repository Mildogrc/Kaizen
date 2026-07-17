// Daily study queue builder: composes the day's blocks from live counts and
// orders/caps them by the selected mode. Pure and tested; the page supplies
// counts from the DB.

export const STUDY_MODES = [
  'balanced',
  'japanese-focused',
  'chinese-focused',
  'math-focused',
  'books-focused',
  'skills-focused',
  'review-heavy',
  'new-content-heavy',
  'exam-cram',
  'mistake-cleanup',
] as const;

export type StudyMode = (typeof STUDY_MODES)[number];

export interface CourseCount {
  courseName: string;
  tab: string; // JAPANESE | CHINESE | MATH | SKILLS | BOOKS | CUSTOM
  count: number;
}

export interface QueueInput {
  inAppDue: CourseCount[]; // due flashcards + practice items
  inAppNew: CourseCount[]; // unseen cards available
  ankiDue: CourseCount[];
  openMistakes: CourseCount[];
  rememberNotes: number; // book notes flagged remember, not yet cards
}

export interface QueueBlock {
  key: string;
  title: string;
  detail: string;
  href: string;
  count: number;
  emphasis: boolean;
}

const MODE_TAB: Partial<Record<StudyMode, string>> = {
  'japanese-focused': 'JAPANESE',
  'chinese-focused': 'CHINESE',
  'math-focused': 'MATH',
  'books-focused': 'BOOKS',
  'skills-focused': 'SKILLS',
};

const sum = (xs: CourseCount[]) => xs.reduce((s, x) => s + x.count, 0);
const names = (xs: CourseCount[]) =>
  xs.filter((x) => x.count > 0).map((x) => `${x.courseName} ${x.count}`).join(' · ');

export function newCardCap(mode: StudyMode): number {
  if (mode === 'review-heavy' || mode === 'exam-cram' || mode === 'mistake-cleanup') return 0;
  if (mode === 'new-content-heavy') return 40;
  return 20;
}

/** Ordered study blocks for the day. Focused modes put their tab first. */
export function buildDailyQueue(input: QueueInput, mode: StudyMode): QueueBlock[] {
  const focusTab = MODE_TAB[mode];
  const split = (xs: CourseCount[]) => ({
    focus: focusTab ? xs.filter((x) => x.tab === focusTab) : xs,
    rest: focusTab ? xs.filter((x) => x.tab !== focusTab) : [],
  });

  const anki = split(input.ankiDue);
  const due = split(input.inAppDue);
  const fresh = split(input.inAppNew);
  const mistakes = split(input.openMistakes);
  const cap = newCardCap(mode);

  const block = (
    key: string,
    title: string,
    xs: CourseCount[],
    href: string,
    emphasis: boolean,
    capTo?: number,
  ): QueueBlock | null => {
    const total = sum(xs);
    if (total === 0) return null;
    const count = capTo !== undefined ? Math.min(total, capTo) : total;
    return { key, title, detail: names(xs), href, count, emphasis };
  };

  const ankiBlock = (xs: CourseCount[], key: string, emphasis: boolean) =>
    block(key, 'Review due cards in Anki', xs, '/analytics', emphasis);
  const reviewBlock = (xs: CourseCount[], key: string, emphasis: boolean) =>
    block(key, 'Clear due in-app reviews', xs, '/review', emphasis);
  const newBlock = (xs: CourseCount[], key: string, emphasis: boolean) =>
    cap === 0 ? null : block(key, `Introduce new cards (up to ${cap})`, xs, '/review', emphasis, cap);
  const mistakeBlock = (xs: CourseCount[], key: string, emphasis: boolean) =>
    block(key, 'Clean up open mistakes', xs, '/mistakes', emphasis);
  const booksBlock = (): QueueBlock | null =>
    input.rememberNotes === 0
      ? null
      : {
          key: 'books',
          title: 'Convert "remember" book notes',
          detail: `${input.rememberNotes} notes flagged`,
          href: '/books',
          count: input.rememberNotes,
          emphasis: mode === 'books-focused',
        };

  let ordered: (QueueBlock | null)[];
  switch (mode) {
    case 'review-heavy':
    case 'exam-cram':
      ordered = [ankiBlock(input.ankiDue, 'anki', true), reviewBlock(input.inAppDue, 'due', true), mistakeBlock(input.openMistakes, 'mistakes', mode === 'exam-cram'), booksBlock()];
      break;
    case 'mistake-cleanup':
      ordered = [mistakeBlock(input.openMistakes, 'mistakes', true), reviewBlock(input.inAppDue, 'due', false), ankiBlock(input.ankiDue, 'anki', false), booksBlock()];
      break;
    case 'new-content-heavy':
      ordered = [newBlock(input.inAppNew, 'new', true), ankiBlock(input.ankiDue, 'anki', false), reviewBlock(input.inAppDue, 'due', false), mistakeBlock(input.openMistakes, 'mistakes', false), booksBlock()];
      break;
    case 'balanced':
      ordered = [ankiBlock(input.ankiDue, 'anki', true), reviewBlock(input.inAppDue, 'due', true), newBlock(input.inAppNew, 'new', false), mistakeBlock(input.openMistakes, 'mistakes', false), booksBlock()];
      break;
    default: {
      // course-focused: the focus tab's work first, everything else after
      ordered = [
        ankiBlock(anki.focus, 'anki-focus', true),
        reviewBlock(due.focus, 'due-focus', true),
        newBlock(fresh.focus, 'new-focus', true),
        mistakeBlock(mistakes.focus, 'mistakes-focus', true),
        ...(mode === 'books-focused' ? [booksBlock()] : []),
        ankiBlock(anki.rest, 'anki-rest', false),
        reviewBlock(due.rest, 'due-rest', false),
        mistakeBlock(mistakes.rest, 'mistakes-rest', false),
        ...(mode === 'books-focused' ? [] : [booksBlock()]),
      ];
    }
  }
  return ordered.filter((b): b is QueueBlock => b !== null);
}
