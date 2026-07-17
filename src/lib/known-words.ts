// Pure known-word logic: parsing Migaku exports (JSON/CSV/TXT) and computing
// union cardinality bounds over normalized entries. No I/O, no tokenizer —
// entries arrive already normalized (see lemmatize.ts).

export const isKanaOnly = (s: string) => /^[぀-ヿー]+$/.test(s);
export const toKatakana = (s: string) =>
  s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// ------------------------------------------------------------ Migaku parse

export interface ParsedWord {
  word: string;
  reading?: string;
  status?: string;
}

export interface ParseResult {
  format: 'json' | 'csv' | 'txt';
  words: ParsedWord[];
  filteredOut: number; // dropped by status filter
}

const WORD_KEYS = ['word', 'term', 'text', 'front', 'vocab', 'expression'];
const STATUS_KEYS = ['status', 'state', 'knownstatus'];
const READING_KEYS = ['reading', 'kana', 'pronunciation'];

function keepStatus(status: string | undefined, includeLearning: boolean): boolean {
  if (!status) return true;
  const s = status.trim().toLowerCase();
  if (s === '' || s === 'known') return true;
  if (includeLearning && s === 'learning') return true;
  return false;
}

/** Minimal CSV line split honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k.toLowerCase()) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Auto-detect and parse a Migaku word export. Accepts the Word Exporter's
 * JSON (objects with word/reading/status), CSV (header row), or plain text
 * (one word per line, optional tab-separated status). Keeps status=Known
 * (+Learning when requested); entries without a status are kept.
 */
export function parseMigakuExport(text: string, includeLearning = false): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { format: 'txt', words: [], filteredOut: 0 };

  // JSON
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const array = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { words?: unknown[] }).words)
          ? (parsed as { words: unknown[] }).words
          : [];
      const all: ParsedWord[] = [];
      for (const entry of array) {
        if (typeof entry === 'string') {
          if (entry.trim()) all.push({ word: entry.trim() });
        } else if (entry && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>;
          const word = pick(obj, WORD_KEYS);
          if (word) all.push({ word, reading: pick(obj, READING_KEYS), status: pick(obj, STATUS_KEYS) });
        }
      }
      const kept = all.filter((w) => keepStatus(w.status, includeLearning));
      return { format: 'json', words: kept, filteredOut: all.length - kept.length };
    } catch {
      // fall through to line-based parsing
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // CSV with a recognizable header
  const header = lines[0] ? splitCsvLine(lines[0]).map((h) => h.toLowerCase()) : [];
  const wordCol = header.findIndex((h) => WORD_KEYS.includes(h));
  if (lines[0]?.includes(',') && wordCol !== -1) {
    const statusCol = header.findIndex((h) => STATUS_KEYS.includes(h));
    const readingCol = header.findIndex((h) => READING_KEYS.includes(h));
    const all: ParsedWord[] = [];
    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const word = cells[wordCol];
      if (!word) continue;
      all.push({
        word,
        reading: readingCol !== -1 ? cells[readingCol] || undefined : undefined,
        status: statusCol !== -1 ? cells[statusCol] || undefined : undefined,
      });
    }
    const kept = all.filter((w) => keepStatus(w.status, includeLearning));
    return { format: 'csv', words: kept, filteredOut: all.length - kept.length };
  }

  // Plain text: word per line, optional tab/comma-separated status in col 2
  const all: ParsedWord[] = lines.map((line) => {
    const [word, maybeStatus] = line.split(/[\t,]/).map((s) => s.trim());
    return { word, status: maybeStatus || undefined };
  });
  const kept = all.filter((w) => w.word && keepStatus(w.status, includeLearning));
  return { format: 'txt', words: kept, filteredOut: all.length - kept.length };
}

// ------------------------------------------------------------ Union bounds

export interface UnionEntry {
  strictKey: string;
  looseKey: string;
  reading: string | null;
  source: string;
}

export interface UnionBounds {
  lower: number;
  upper: number;
  bySource: Record<string, number>; // distinct strictKeys per source
  /** strictKeys seen in 2+ sources — definite overlap */
  overlap: number;
}

/**
 * Cardinality bounds for the union of known words.
 * Upper: distinct strictKeys (merge only certain duplicates).
 * Lower: distinct looseKeys, additionally merging kana-only lemmas into a
 * kanji entry that reads the same (わかる ≡ 分かる).
 */
export function unionBounds(entries: UnionEntry[]): UnionBounds {
  const strict = new Set(entries.map((e) => e.strictKey));

  // Loose groups by looseKey.
  const groupOf = new Map<string, string>(); // looseKey -> group id
  for (const e of entries) if (!groupOf.has(e.looseKey)) groupOf.set(e.looseKey, e.looseKey);

  // Reading → the group of some non-kana lemma with that reading.
  const readingToKanjiGroup = new Map<string, string>();
  for (const e of entries) {
    if (e.reading && !isKanaOnly(e.looseKey)) readingToKanjiGroup.set(e.reading, groupOf.get(e.looseKey)!);
  }
  // Kana-only lemmas that sound like a kanji entry merge into its group.
  for (const e of entries) {
    if (!isKanaOnly(e.looseKey)) continue;
    const kanjiGroup = readingToKanjiGroup.get(toKatakana(e.looseKey));
    if (kanjiGroup) groupOf.set(e.looseKey, kanjiGroup);
  }
  const lower = new Set([...groupOf.values()]).size;

  const bySource: Record<string, Set<string>> = {};
  for (const e of entries) {
    (bySource[e.source] ??= new Set()).add(e.strictKey);
  }
  const sourcesPerKey = new Map<string, Set<string>>();
  for (const e of entries) {
    (sourcesPerKey.get(e.strictKey) ?? sourcesPerKey.set(e.strictKey, new Set()).get(e.strictKey)!).add(e.source);
  }
  const overlap = [...sourcesPerKey.values()].filter((s) => s.size > 1).length;

  return {
    lower,
    upper: strict.size,
    bySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.size])),
    overlap,
  };
}
