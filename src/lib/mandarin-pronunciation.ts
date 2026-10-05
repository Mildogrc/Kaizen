import { stripAnkiHtml } from './anki-html';

export const MANDARIN_TONES = [1, 2, 3, 4, 5] as const;
export type MandarinTone = (typeof MANDARIN_TONES)[number];
export const MANDARIN_INITIAL_TONES = [1, 2, 3, 4] as const;
export type MandarinInitialTone = (typeof MANDARIN_INITIAL_TONES)[number];
export type TonePairKey = `${MandarinInitialTone}-${MandarinTone}`;

export interface ToneSyllable {
  pinyin: string;
  tone: MandarinTone;
}

export interface MandarinPronunciationCandidate {
  ankiCardId: string;
  word: string;
  definition: string;
  syllables: [ToneSyllable, ToneSyllable];
  tonePair: TonePairKey;
  audioFilename: string;
}

type AnkiFields = Record<string, { value: string; order?: number }>;

const TONE_MARKS: Record<string, { base: string; tone: MandarinTone }> = {
  ā: { base: 'a', tone: 1 }, á: { base: 'a', tone: 2 }, ǎ: { base: 'a', tone: 3 }, à: { base: 'a', tone: 4 },
  ē: { base: 'e', tone: 1 }, é: { base: 'e', tone: 2 }, ě: { base: 'e', tone: 3 }, è: { base: 'e', tone: 4 },
  ī: { base: 'i', tone: 1 }, í: { base: 'i', tone: 2 }, ǐ: { base: 'i', tone: 3 }, ì: { base: 'i', tone: 4 },
  ō: { base: 'o', tone: 1 }, ó: { base: 'o', tone: 2 }, ǒ: { base: 'o', tone: 3 }, ò: { base: 'o', tone: 4 },
  ū: { base: 'u', tone: 1 }, ú: { base: 'u', tone: 2 }, ǔ: { base: 'u', tone: 3 }, ù: { base: 'u', tone: 4 },
  ǖ: { base: 'ü', tone: 1 }, ǘ: { base: 'ü', tone: 2 }, ǚ: { base: 'ü', tone: 3 }, ǜ: { base: 'ü', tone: 4 },
  ń: { base: 'n', tone: 2 }, ň: { base: 'n', tone: 3 }, ǹ: { base: 'n', tone: 4 },
  ḿ: { base: 'm', tone: 2 },
};

const MARKED_VOWELS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

function fieldValue(fields: AnkiFields, name: string): string {
  const entry = Object.entries(fields).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1].value ?? '';
}

function toneOf(syllable: string): MandarinTone {
  const normalized = syllable.trim().toLowerCase().normalize('NFC');
  const numberedTone = normalized.match(/([1-5])$/)?.[1];
  if (numberedTone) return Number(numberedTone) as MandarinTone;
  for (const character of normalized) {
    const marked = TONE_MARKS[character];
    if (marked) return marked.tone;
  }
  return 5;
}

function unmarkedPinyin(syllable: string): string {
  return [...syllable.trim().toLowerCase().normalize('NFC')]
    .map((character) => TONE_MARKS[character]?.base ?? (character === 'v' ? 'ü' : character))
    .join('')
    .replace(/[1-5]$/u, '');
}

function pinyinWithTone(syllable: string, tone: MandarinTone): string {
  const base = unmarkedPinyin(syllable);
  if (tone === 5) return base;
  const characters = [...base];
  const lower = base.toLowerCase();
  let vowelIndex = lower.indexOf('a');
  if (vowelIndex === -1) vowelIndex = lower.indexOf('e');
  if (vowelIndex === -1 && lower.includes('ou')) vowelIndex = lower.indexOf('o');
  if (vowelIndex === -1) {
    for (let index = characters.length - 1; index >= 0; index--) {
      if (MARKED_VOWELS[characters[index]]) {
        vowelIndex = index;
        break;
      }
    }
  }
  if (vowelIndex === -1) return base;
  const marks = MARKED_VOWELS[characters[vowelIndex]];
  characters[vowelIndex] = marks[tone - 1];
  return characters.join('');
}

function rubySyllables(wordRuby: string): string[] {
  return [...wordRuby.matchAll(/<rt[^>]*>([\s\S]*?)<\/rt>/giu)]
    .map((match) => stripAnkiHtml(match[1]))
    .filter(Boolean);
}

function spokenTonePair(word: string, source: [ToneSyllable, ToneSyllable]): [ToneSyllable, ToneSyllable] {
  const syllables: [ToneSyllable, ToneSyllable] = [
    { ...source[0] },
    { ...source[1] },
  ];
  const secondTone = syllables[1].tone;

  if (word.startsWith('不') && secondTone === 4) {
    syllables[0] = { pinyin: pinyinWithTone(syllables[0].pinyin, 2), tone: 2 };
  } else if (word.startsWith('一') && secondTone === 4) {
    syllables[0] = { pinyin: pinyinWithTone(syllables[0].pinyin, 2), tone: 2 };
  } else if (word.startsWith('一') && secondTone >= 1 && secondTone <= 3) {
    syllables[0] = { pinyin: pinyinWithTone(syllables[0].pinyin, 4), tone: 4 };
  }

  return syllables;
}

function wordAudioFilename(value: string): string | null {
  return value.match(/\[sound:([^\]]+)\]/iu)?.[1]?.trim() || null;
}

export function mandarinPronunciationCandidate(
  ankiCardId: string,
  fields: AnkiFields,
): MandarinPronunciationCandidate | null {
  const word = stripAnkiHtml(fieldValue(fields, 'Word'));
  const readings = rubySyllables(fieldValue(fields, 'WordRuby'));
  const audioFilename = wordAudioFilename(fieldValue(fields, 'WordAudio'));
  if (!word || readings.length !== 2 || !audioFilename) return null;

  const source: [ToneSyllable, ToneSyllable] = [
    { pinyin: readings[0], tone: toneOf(readings[0]) },
    { pinyin: readings[1], tone: toneOf(readings[1]) },
  ];
  const syllables = spokenTonePair(word, source);
  if (syllables[0].tone === 5) return null;
  return {
    ankiCardId,
    word,
    definition: stripAnkiHtml(fieldValue(fields, 'Definition')),
    syllables,
    tonePair: `${syllables[0].tone}-${syllables[1].tone}`,
    audioFilename,
  };
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function toneRotationPeriod(date: Date): number {
  return Math.floor(localDayNumber(date) / 3);
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectTonePairGrid(
  candidates: MandarinPronunciationCandidate[],
  date: Date,
): Record<TonePairKey, MandarinPronunciationCandidate | null> {
  const period = toneRotationPeriod(date);
  return Object.fromEntries(MANDARIN_INITIAL_TONES.flatMap((firstTone) => MANDARIN_TONES.map((secondTone) => {
    const tonePair = `${firstTone}-${secondTone}` as TonePairKey;
    const options = [...new Map(
      candidates
        .filter((candidate) => candidate.tonePair === tonePair)
        .map((candidate) => [candidate.word, candidate]),
    ).values()].sort((left, right) => left.word.localeCompare(right.word, 'zh') || left.ankiCardId.localeCompare(right.ankiCardId));
    const selected = options.length
      ? options[(stableHash(tonePair) + period) % options.length]
      : null;
    return [tonePair, selected];
  }))) as Record<TonePairKey, MandarinPronunciationCandidate | null>;
}

export function nextToneRotationAt(date: Date): Date {
  const dayNumber = localDayNumber(date);
  const nextDayNumber = (toneRotationPeriod(date) + 1) * 3;
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + nextDayNumber - dayNumber);
  return next;
}
