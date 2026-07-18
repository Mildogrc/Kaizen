export const MANDARIN_BLUEPRINT_LEVELS = 88;
export const TRAVERSE_PROGRESS_ENDPOINT = 'https://us-central1-alley-d0944.cloudfunctions.net/getLevelProgress';
export const CHISHO_BASE_URL = 'https://chisho.org/';

export interface MandarinBlueprintCsvRow {
  phase: number | null;
  level: number;
  newCharacters: number;
  totalCharacters: number;
  newWords: number;
  totalWords: number;
  weeks: number | null;
  characters: string[];
}

export interface TraverseLevelProgress {
  words: string[];
  characters: string[];
  totalWords: number;
  totalCharacters: number;
  groups: Record<string, { old: string[]; new: string[] }>;
}

export interface ChishoEntry {
  surface: string;
  traditional: string | null;
  pinyin: string[];
  definitions: string[];
  audioUrls: string[];
  sourceUrl: string;
}

const number = (value: string) => Number.parseInt(value.trim(), 10) || 0;

export function parseMandarinBlueprintCsv(csv: string): MandarinBlueprintCsvRow[] {
  let currentPhase: number | null = null;
  return csv.trim().split(/\r?\n/).slice(1).flatMap((line) => {
    const columns = line.split(',');
    if (columns.length < 10) return [];
    if (columns[0].trim()) currentPhase = number(columns[0]);
    const level = number(columns[1]);
    if (level < 1 || level > MANDARIN_BLUEPRINT_LEVELS) return [];
    return [{
      phase: currentPhase,
      level,
      newCharacters: number(columns[2]),
      totalCharacters: number(columns[3]),
      newWords: number(columns[4]),
      totalWords: number(columns[5]),
      weeks: columns[8].trim() ? number(columns[8]) : null,
      characters: [...columns[9].trim()],
    }];
  });
}

export async function fetchTraverseLevel(level: number): Promise<TraverseLevelProgress> {
  if (!Number.isInteger(level) || level < 1 || level > MANDARIN_BLUEPRINT_LEVELS) throw new Error('Mandarin Blueprint level must be 1–88.');
  const response = await fetch(TRAVERSE_PROGRESS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { level: String(level) } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Traverse level ${level} failed with ${response.status}.`);
  const body = await response.json() as { result?: Record<string, { old?: unknown; new?: unknown }> };
  if (!body.result) throw new Error(`Traverse level ${level} returned no result.`);
  const groups = Object.fromEntries(Object.entries(body.result).map(([name, value]) => [name, {
    old: Array.isArray(value.old) ? value.old.filter((item): item is string => typeof item === 'string') : [],
    new: Array.isArray(value.new) ? value.new.filter((item): item is string => typeof item === 'string') : [],
  }]));
  const words = groups['All Words'] ?? { old: [], new: [] };
  const characters = groups['All Characters'] ?? { old: [], new: [] };
  return { words: words.new, characters: characters.new, totalWords: words.old.length + words.new.length, totalCharacters: characters.old.length + characters.new.length, groups };
}

export async function syncMandarinBlueprintLevels(csv: string) {
  const { prisma } = await import('./db');
  const rows = parseMandarinBlueprintCsv(csv);
  if (rows.length !== MANDARIN_BLUEPRINT_LEVELS) throw new Error(`Expected 88 CSV levels, found ${rows.length}.`);
  const progress = new Map<number, TraverseLevelProgress>();
  for (let start = 0; start < rows.length; start += 6) {
    const batch = rows.slice(start, start + 6);
    const results = await Promise.all(batch.map((row) => fetchTraverseLevel(row.level)));
    results.forEach((result, index) => progress.set(batch[index].level, result));
  }
  for (const row of rows) {
    const traverse = progress.get(row.level)!;
    await prisma.mandarinBlueprintLevel.upsert({
      where: { level: row.level },
      create: {
        level: row.level,
        phase: row.phase,
        reportedNewCharacterCount: row.newCharacters,
        reportedTotalCharacters: row.totalCharacters,
        reportedNewWordCount: row.newWords,
        reportedTotalWords: row.totalWords,
        characters: traverse.characters,
        words: traverse.words,
        sourceStats: { csvCharacters: row.characters, weeks: row.weeks, traverseTotalWords: traverse.totalWords, traverseTotalCharacters: traverse.totalCharacters },
      },
      update: {
        phase: row.phase,
        reportedNewCharacterCount: row.newCharacters,
        reportedTotalCharacters: row.totalCharacters,
        reportedNewWordCount: row.newWords,
        reportedTotalWords: row.totalWords,
        characters: traverse.characters,
        words: traverse.words,
        sourceStats: { csvCharacters: row.characters, weeks: row.weeks, traverseTotalWords: traverse.totalWords, traverseTotalCharacters: traverse.totalCharacters },
      },
    });
  }
  return { levels: rows.length, totalWords: progress.get(88)?.totalWords ?? 0, totalCharacters: progress.get(88)?.totalCharacters ?? 0 };
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseChishoHtml(surface: string, html: string): ChishoEntry {
  const firstResult = html.match(/<li>([\s\S]*?)<\/li>/)?.[1] ?? '';
  const pinyinText = firstResult.match(/class="annotation[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '';
  const characterText = decodeHtml(firstResult.match(/class="character[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
  const traditional = characterText.split('〔')[0].trim() || null;
  const audioUrls = [...firstResult.matchAll(/<audio[^>]+src="([^"]+)"/g)].map((match) => new URL(match[1], CHISHO_BASE_URL).toString());
  const definitionColumn = firstResult.match(/class="basis-3\/4[^"]*"[^>]*>([\s\S]*)/)?.[1] ?? '';
  const definitions = [...definitionColumn.matchAll(/<div>([\s\S]*?)<\/div>/g)]
    .map((match) => decodeHtml(match[1]).replace(/^\d+\.\s*/, ''))
    .filter(Boolean);
  const pinyin = decodeHtml(pinyinText).split('/').map((reading) => reading.trim()).filter(Boolean);
  return { surface, traditional, pinyin, definitions, audioUrls, sourceUrl: `${CHISHO_BASE_URL}?q=${encodeURIComponent(surface)}` };
}

export async function lookupChisho(surface: string): Promise<ChishoEntry> {
  const sourceUrl = `${CHISHO_BASE_URL}?q=${encodeURIComponent(surface)}`;
  const response = await fetch(sourceUrl, { cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Kaizen personal learning app dictionary lookup' } });
  if (!response.ok) throw new Error(`Chisho lookup failed for ${surface}: ${response.status}.`);
  return parseChishoHtml(surface, await response.text());
}

export function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function enrichMandarinBlueprintLevel(levelNumber: number) {
  const { prisma } = await import('./db');
  const level = await prisma.mandarinBlueprintLevel.findUnique({ where: { level: levelNumber } });
  if (!level) throw new Error(`Mandarin Blueprint level ${levelNumber} is not imported.`);
  const entries = [
    ...jsonStrings(level.characters).map((surface) => ({ surface, kind: 'CHARACTER' as const })),
    ...jsonStrings(level.words).map((surface) => ({ surface, kind: 'WORD' as const })),
  ];
  const existing = await prisma.mandarinDictionaryEntry.findMany({ where: { OR: entries.map((entry) => ({ surface: entry.surface, kind: entry.kind })) }, select: { surface: true, kind: true } });
  const existingKeys = new Set(existing.map((entry) => `${entry.kind}\u0000${entry.surface}`));
  const missing = entries.filter((entry) => !existingKeys.has(`${entry.kind}\u0000${entry.surface}`));
  const bySurface = new Map<string, typeof missing>();
  for (const entry of missing) bySurface.set(entry.surface, [...(bySurface.get(entry.surface) ?? []), entry]);
  const surfaces = [...bySurface.keys()];
  let fetched = 0;
  for (let start = 0; start < surfaces.length; start += 4) {
    const batch = surfaces.slice(start, start + 4);
    const lookups = await Promise.all(batch.map(async (surface) => {
      try { return await lookupChisho(surface); }
      catch { return { surface, traditional: null, pinyin: [], definitions: [], audioUrls: [], sourceUrl: `${CHISHO_BASE_URL}?q=${encodeURIComponent(surface)}` }; }
    }));
    for (const lookup of lookups) {
      for (const entry of bySurface.get(lookup.surface) ?? []) {
        await prisma.mandarinDictionaryEntry.upsert({
          where: { surface_kind: { surface: entry.surface, kind: entry.kind } },
          create: { surface: entry.surface, kind: entry.kind, traditional: lookup.traditional, pinyin: lookup.pinyin, definitions: lookup.definitions, audioUrls: lookup.audioUrls, sourceUrl: lookup.sourceUrl },
          update: { traditional: lookup.traditional, pinyin: lookup.pinyin, definitions: lookup.definitions, audioUrls: lookup.audioUrls, sourceUrl: lookup.sourceUrl, fetchedAt: new Date() },
        });
        fetched++;
      }
    }
    if (start + 4 < surfaces.length) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { level: levelNumber, total: entries.length, cached: entries.length - missing.length, fetched };
}
