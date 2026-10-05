import type { AnkiNoteInput } from './anki-connect';

export const CHARACTER_MODEL = 'Kaizen Mandarin Character';
export const REVERSED_CHARACTER_MODEL = 'Kaizen Mandarin Character Reversed';
export const WORD_MODEL = 'Kaizen Mandarin Word';

const CARD_CSS = '.card { font-family: Arial, sans-serif; font-size: 22px; text-align: center; color: #111; background: #fff; } .hanzi { font-size: 64px; margin: 12px; } .pinyin { color: #555; margin: 8px; } .definitions { text-align: left; font-size: 18px; line-height: 1.45; }';

export const MANDARIN_ANKI_MODELS: {
  modelName: string;
  inOrderFields: string[];
  css: string;
  cardTemplates: { Name: string; Front: string; Back: string }[];
}[] = [
  {
    modelName: CHARACTER_MODEL,
    inOrderFields: ['Cue', 'Character', 'Traditional', 'Pinyin', 'Definitions', 'Audio', 'Level', 'Source'],
    css: CARD_CSS,
    cardTemplates: [{ Name: 'Word → Character', Front: '<div class="definitions">{{Cue}}</div>', Back: '{{FrontSide}}<hr><div class="hanzi">{{Character}}</div><div class="pinyin">{{Pinyin}}</div>{{Audio}}<div class="definitions">{{Definitions}}</div><div>{{Traditional}}</div>' }],
  },
  {
    modelName: REVERSED_CHARACTER_MODEL,
    inOrderFields: ['Character', 'Cue', 'Traditional', 'Pinyin', 'Definitions', 'Audio', 'Level', 'Source'],
    css: CARD_CSS,
    cardTemplates: [{ Name: 'Character → Word', Front: '<div class="hanzi">{{Character}}</div>', Back: '{{FrontSide}}<hr><div class="pinyin">{{Pinyin}}</div>{{Audio}}<div class="definitions">{{Definitions}}</div><div>{{Traditional}}</div>' }],
  },
  {
    modelName: WORD_MODEL,
    inOrderFields: ['Word', 'Traditional', 'Pinyin', 'Definitions', 'Audio', 'Level', 'Source'],
    css: CARD_CSS,
    cardTemplates: [{ Name: 'Word → Details', Front: '<div class="hanzi">{{Word}}</div>', Back: '{{FrontSide}}<hr><div class="pinyin">{{Pinyin}}</div>{{Audio}}<div class="definitions">{{Definitions}}</div><div>{{Traditional}}</div>' }],
  },
];

interface MandarinDeckConfiguration {
  characterDeckName: string;
  reversedCharacterDeckName: string;
  wordDeckName: string;
}

export interface MandarinAnkiEntry {
  surface: string;
  traditional?: string | null;
  pinyin: string[];
  definitions: string[];
  audioUrls: string[];
  sourceUrl?: string | null;
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function definitionHtml(definitions: string[]): string {
  return definitions.length ? `<ol>${definitions.map((definition) => `<li>${html(definition)}</li>`).join('')}</ol>` : '<span>No dictionary definition found.</span>';
}

function filename(url: string, surface: string, index: number): string {
  let hash = 2166136261;
  for (const character of `${surface}\u0000${url}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const extension = new URL(url).pathname.split('.').at(-1)?.replace(/[^a-z0-9]/gi, '') || 'mp3';
  return `kaizen_mb_${(hash >>> 0).toString(16)}_${index}.${extension}`;
}

function commonNote(entry: MandarinAnkiEntry, levelNumber: number, tags: string[]) {
  return {
    tags: ['mandarin-blueprint', `mandarin-blueprint-level-${levelNumber}`, ...tags],
    options: { allowDuplicate: false, duplicateScope: 'deck' },
    audio: entry.audioUrls.map((url, index) => ({ url, filename: filename(url, entry.surface, index), fields: ['Audio'] })),
  } satisfies Pick<AnkiNoteInput, 'tags' | 'options' | 'audio'>;
}

export function buildMandarinCharacterNotes(entry: MandarinAnkiEntry, configuration: MandarinDeckConfiguration, levelNumber: number): [AnkiNoteInput, AnkiNoteInput] {
  const sharedFields = {
    Cue: html(entry.definitions[0] ?? entry.surface),
    Character: html(entry.surface),
    Traditional: html(entry.traditional ?? ''),
    Pinyin: html(entry.pinyin.join(' / ')),
    Definitions: definitionHtml(entry.definitions),
    Audio: '',
    Level: String(levelNumber),
    Source: html(entry.sourceUrl ?? ''),
  };
  return [
    {
      ...commonNote(entry, levelNumber, ['character', 'character-standard']),
      deckName: configuration.characterDeckName,
      modelName: CHARACTER_MODEL,
      fields: sharedFields,
    },
    {
      ...commonNote(entry, levelNumber, ['character', 'character-reversed']),
      deckName: configuration.reversedCharacterDeckName,
      modelName: REVERSED_CHARACTER_MODEL,
      fields: sharedFields,
    },
  ];
}

export function buildMandarinWordNote(entry: MandarinAnkiEntry, configuration: MandarinDeckConfiguration, levelNumber: number): AnkiNoteInput {
  return {
    ...commonNote(entry, levelNumber, ['word']),
    deckName: configuration.wordDeckName,
    modelName: WORD_MODEL,
    fields: {
      Word: html(entry.surface),
      Traditional: html(entry.traditional ?? ''),
      Pinyin: html(entry.pinyin.join(' / ')),
      Definitions: definitionHtml(entry.definitions),
      Audio: '',
      Level: String(levelNumber),
      Source: html(entry.sourceUrl ?? ''),
    },
  };
}
