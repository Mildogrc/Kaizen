import kanjiExtract from '../../kanji_extract.json';

export interface RtkKanjiEntry {
  kanji: string;
  keyword: string | null;
  rtkNumber: number | null;
  book: number | null;
  lesson: number | null;
  metadata: Record<string, unknown>;
}

export interface KanjiExtractResult {
  entries: RtkKanjiEntry[];
  warnings: string[];
  error: string | null;
  sourcePath: string | null;
}

const ARRAY_KEYS = ['kanji', 'characters', 'entries', 'items', 'records', 'data'] as const;
const KANJI_KEYS = ['kanji', 'character', 'literal', 'glyph', 'symbol'] as const;
const KEYWORD_KEYS = ['keyword', 'rtkKeyword', 'heisigKeyword', 'meaning', 'keyWord', 'english'] as const;
const NUMBER_KEYS = ['rtkNumber', 'rtk_number', 'heisigNumber', 'heisig_number', 'frame', 'frameNumber', 'frame_number', 'number', 'index'] as const;
const BOOK_KEYS = ['book', 'volume', 'rtkBook', 'rtk_book'] as const;
const LESSON_KEYS = ['lesson', 'lessonNumber', 'lesson_number'] as const;

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)
    ? Number(value.match(/\d+/)?.[0])
    : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function singleKanji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const matches = [...value.matchAll(/\p{Script=Han}/gu)].map((match) => match[0]);
  return matches.length === 1 ? matches[0] : null;
}

function rawRows(input: unknown): Array<{ fallbackKanji?: string; value: unknown }> | null {
  if (Array.isArray(input)) return input.map((value) => ({ value }));
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).map((value) => ({ value }));
  }
  const objectEntries = Object.entries(record);
  const directArrays = objectEntries.flatMap(([, value]) => Array.isArray(value) ? value : []);
  if (directArrays.length > 0) return directArrays.map((value) => ({ value }));
  const nestedArrays = objectEntries.flatMap(([, value]) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.values(value as Record<string, unknown>).flatMap((nested) => Array.isArray(nested) ? nested : [])
    : []);
  if (nestedArrays.length > 0) return nestedArrays.map((value) => ({ value }));
  const kanjiKeyedEntries = objectEntries.filter(([key, value]) => singleKanji(key) && value && typeof value === 'object' && !Array.isArray(value));
  if (kanjiKeyedEntries.length > 0) return kanjiKeyedEntries.map(([fallbackKanji, value]) => ({ fallbackKanji, value }));
  return null;
}

export function parseKanjiExtract(input: unknown): KanjiExtractResult {
  const rows = rawRows(input);
  if (!rows) {
    return { entries: [], warnings: [], error: 'The RTK extract must contain an array of kanji records.', sourcePath: null };
  }

  const warnings: string[] = [];
  const entries = new Map<string, RtkKanjiEntry>();
  rows.forEach((row, index) => {
    if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) {
      warnings.push(`Record ${index + 1} is not an object and was skipped.`);
      return;
    }
    const record = row.value as Record<string, unknown>;
    const kanji = singleKanji(firstValue(record, KANJI_KEYS)) ?? singleKanji(row.fallbackKanji);
    if (!kanji) {
      warnings.push(`Record ${index + 1} has no single kanji character and was skipped.`);
      return;
    }
    if (entries.has(kanji)) {
      warnings.push(`Duplicate kanji ${kanji} was ignored.`);
      return;
    }
    const keyword = optionalString(firstValue(record, KEYWORD_KEYS));
    if (!keyword) warnings.push(`Kanji ${kanji} has no RTK keyword.`);
    entries.set(kanji, {
      kanji,
      keyword,
      rtkNumber: optionalNumber(firstValue(record, NUMBER_KEYS)),
      book: optionalNumber(firstValue(record, BOOK_KEYS)),
      lesson: optionalNumber(firstValue(record, LESSON_KEYS)),
      metadata: record,
    });
  });

  if (entries.size === 0) {
    return { entries: [], warnings, error: 'The RTK extract did not contain any valid kanji records.', sourcePath: null };
  }
  return { entries: [...entries.values()], warnings, error: null, sourcePath: null };
}

export async function loadKanjiExtract(): Promise<KanjiExtractResult> {
  try {
    const parsed = parseKanjiExtract(kanjiExtract);
    return { ...parsed, sourcePath: 'kanji_extract.json' };
  } catch (error) {
    return {
      entries: [],
      warnings: [],
      error: `Could not load kanji_extract.json: ${(error as Error).message}`,
      sourcePath: 'kanji_extract.json',
    };
  }
}
