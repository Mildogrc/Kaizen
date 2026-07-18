// Thin AnkiConnect client (https://foosoft.net/projects/anki-connect/).
// Talks to the local Anki desktop instance at 127.0.0.1:8765 while it is
// running with the AnkiConnect add-on (code 2055492159). Every helper
// degrades to a typed "not connected" result instead of throwing on
// connection failure — the app must stay fully usable with Anki closed.

const ANKI_URL = process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765';
const TIMEOUT_MS = 5_000;

export class AnkiUnavailableError extends Error {
  constructor() {
    super('Anki is not reachable. Start Anki with the AnkiConnect add-on installed.');
  }
}

async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ANKI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new AnkiUnavailableError();
  }
  const body = (await res.json()) as { result: T; error: string | null };
  if (body.error) throw new Error(`AnkiConnect ${action}: ${body.error}`);
  return body.result;
}

export async function ankiStatus(): Promise<{ connected: boolean; version?: number }> {
  try {
    const version = await invoke<number>('version');
    return { connected: true, version };
  } catch {
    return { connected: false };
  }
}

export async function deckNames(): Promise<string[]> {
  return invoke<string[]>('deckNames');
}

export async function createDeck(deck: string): Promise<number> {
  return invoke<number>('createDeck', { deck });
}

export async function modelNames(): Promise<string[]> {
  return invoke<string[]>('modelNames');
}

export async function createModel(input: {
  modelName: string;
  inOrderFields: string[];
  css: string;
  cardTemplates: { Name: string; Front: string; Back: string }[];
}): Promise<number> {
  return invoke<number>('createModel', input);
}

export interface AnkiNoteInput {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  options?: { allowDuplicate?: boolean; duplicateScope?: string };
  audio?: { url: string; filename: string; fields: string[] }[];
}

export async function addNotes(notes: AnkiNoteInput[]): Promise<(number | null)[]> {
  const results: (number | null)[] = [];
  for (let i = 0; i < notes.length; i += 50) {
    results.push(...await invoke<(number | null)[]>('addNotes', { notes: notes.slice(i, i + 50) }));
  }
  return results;
}

export async function findCards(query: string): Promise<number[]> {
  return invoke<number[]>('findCards', { query });
}

export interface AnkiCardInfo {
  cardId: number;
  question: string;
  answer: string;
  deckName: string;
  fields: Record<string, { value: string; order: number }>;
  interval: number; // days (negative = seconds, per Anki convention)
  factor: number; // permille ease, 0 for new
  reps: number;
  lapses: number;
  due: number;
  queue: number; // -3..3: buried/sched-buried/suspended/new/learning/review/day-learn
  type: number; // 0 new, 1 learning, 2 review, 3 relearning
  note: number;
}

const CHUNK = 200;

export async function cardsInfo(cardIds: number[]): Promise<AnkiCardInfo[]> {
  const out: AnkiCardInfo[] = [];
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    out.push(...(await invoke<AnkiCardInfo[]>('cardsInfo', { cards: cardIds.slice(i, i + CHUNK) })));
  }
  return out;
}

/** Card ids Anki currently considers due (new/learning/review) per deck. */
export async function dueCounts(deckName: string): Promise<{ new: number; learning: number; review: number }> {
  const esc = deckName.replace(/"/g, '\\"');
  const [n, l, r] = await Promise.all([
    invoke<number[]>('findCards', { query: `deck:"${esc}" is:new` }),
    invoke<number[]>('findCards', { query: `deck:"${esc}" is:learn` }),
    invoke<number[]>('findCards', { query: `deck:"${esc}" is:due -is:learn` }),
  ]);
  return { new: n.length, learning: l.length, review: r.length };
}

/**
 * Review log entries for a deck since startID (an Anki revlog id = epoch ms).
 * Each entry: [reviewTime, cardID, usn, buttonPressed, newInterval,
 * previousInterval, newFactor, reviewDuration, reviewType]
 */
export type AnkiReviewTuple = [number, number, number, number, number, number, number, number, number];

export async function cardReviews(deckName: string, startID: number): Promise<AnkiReviewTuple[]> {
  return invoke<AnkiReviewTuple[]>('cardReviews', { deck: deckName, startID });
}

/** Tags for a batch of notes — used for leech detection. */
export async function notesInfoTags(noteIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  for (let i = 0; i < noteIds.length; i += CHUNK) {
    const infos = await invoke<{ noteId: number; tags: string[] }[]>('notesInfo', {
      notes: noteIds.slice(i, i + CHUNK),
    });
    for (const info of infos) map.set(info.noteId, info.tags ?? []);
  }
  return map;
}
