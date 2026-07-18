import { addNotes, createDeck, createModel, modelNames, type AnkiNoteInput } from './anki-connect';
import { mandarinBlueprintConfiguration } from './app-settings';
import { prisma } from './db';
import { enrichMandarinBlueprintLevel, jsonStrings } from './mandarin-blueprint';

const CHARACTER_MODEL = 'Kaizen Mandarin Character';
const WORD_MODEL = 'Kaizen Mandarin Word';
const CARD_CSS = '.card { font-family: Arial, sans-serif; font-size: 22px; text-align: center; color: #111; background: #fff; } .hanzi { font-size: 64px; margin: 12px; } .pinyin { color: #555; margin: 8px; } .definitions { text-align: left; font-size: 18px; line-height: 1.45; }';

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

async function ensureModels() {
  const existing = new Set(await modelNames());
  if (!existing.has(CHARACTER_MODEL)) {
    await createModel({
      modelName: CHARACTER_MODEL,
      inOrderFields: ['Cue', 'Character', 'Traditional', 'Pinyin', 'Definitions', 'Audio', 'Level', 'Source'],
      css: CARD_CSS,
      cardTemplates: [{ Name: 'Definition → Character', Front: '<div class="definitions">{{Cue}}</div>', Back: '{{FrontSide}}<hr><div class="hanzi">{{Character}}</div><div class="pinyin">{{Pinyin}}</div>{{Audio}}<div class="definitions">{{Definitions}}</div><div>{{Traditional}}</div>' }],
    });
  }
  if (!existing.has(WORD_MODEL)) {
    await createModel({
      modelName: WORD_MODEL,
      inOrderFields: ['Word', 'Traditional', 'Pinyin', 'Definitions', 'Audio', 'Level', 'Source'],
      css: CARD_CSS,
      cardTemplates: [{ Name: 'Word → Details', Front: '<div class="hanzi">{{Word}}</div>', Back: '{{FrontSide}}<hr><div class="pinyin">{{Pinyin}}</div>{{Audio}}<div class="definitions">{{Definitions}}</div><div>{{Traditional}}</div>' }],
    });
  }
}

export async function pushMandarinBlueprintLevel(levelNumber: number) {
  await enrichMandarinBlueprintLevel(levelNumber);
  const [level, user, chinese] = await Promise.all([
    prisma.mandarinBlueprintLevel.findUnique({ where: { level: levelNumber } }),
    prisma.user.findFirst(),
    prisma.course.findUnique({ where: { slug: 'chinese' } }),
  ]);
  if (!level || !chinese) throw new Error('Mandarin Blueprint or Chinese course is not initialized.');
  const configuration = mandarinBlueprintConfiguration(user?.settings);
  const characters = jsonStrings(level.characters);
  const words = jsonStrings(level.words);
  const requested = [
    ...characters.map((surface) => ({ surface, kind: 'CHARACTER' as const })),
    ...words.map((surface) => ({ surface, kind: 'WORD' as const })),
  ];
  const entries = await prisma.mandarinDictionaryEntry.findMany({ where: { OR: requested.map((entry) => ({ surface: entry.surface, kind: entry.kind })) } });
  const byKey = new Map(entries.map((entry) => [`${entry.kind}\u0000${entry.surface}`, entry]));
  await Promise.all([createDeck(configuration.characterDeckName), createDeck(configuration.wordDeckName), ensureModels()]);
  const notes = requested.map<AnkiNoteInput>(({ surface, kind }) => {
    const entry = byKey.get(`${kind}\u0000${surface}`);
    const pinyin = strings(entry?.pinyin);
    const definitions = strings(entry?.definitions);
    const audioUrls = strings(entry?.audioUrls);
    const audio = audioUrls.map((url, index) => ({ url, filename: filename(url, surface, index), fields: ['Audio'] }));
    const common = { tags: ['mandarin-blueprint', `mandarin-blueprint-level-${levelNumber}`, kind.toLowerCase()], options: { allowDuplicate: false, duplicateScope: 'deck' }, audio };
    if (kind === 'CHARACTER') {
      const fields: Record<string, string> = { Cue: html(definitions[0] ?? surface), Character: html(surface), Traditional: html(entry?.traditional ?? ''), Pinyin: html(pinyin.join(' / ')), Definitions: definitionHtml(definitions), Audio: '', Level: String(levelNumber), Source: html(entry?.sourceUrl ?? '') };
      return { ...common, deckName: configuration.characterDeckName, modelName: CHARACTER_MODEL, fields };
    }
    const fields: Record<string, string> = { Word: html(surface), Traditional: html(entry?.traditional ?? ''), Pinyin: html(pinyin.join(' / ')), Definitions: definitionHtml(definitions), Audio: '', Level: String(levelNumber), Source: html(entry?.sourceUrl ?? '') };
    return { ...common, deckName: configuration.wordDeckName, modelName: WORD_MODEL, fields };
  });
  const results = await addNotes(notes);
  await Promise.all([
    prisma.ankiDeckMapping.upsert({ where: { deckName: configuration.characterDeckName }, create: { deckName: configuration.characterDeckName, courseId: chinese.id, countsKnownWords: false }, update: { courseId: chinese.id, countsKnownWords: false } }),
    prisma.ankiDeckMapping.upsert({ where: { deckName: configuration.wordDeckName }, create: { deckName: configuration.wordDeckName, courseId: chinese.id, countsKnownWords: true }, update: { courseId: chinese.id, countsKnownWords: true } }),
  ]);
  return { requested: notes.length, added: results.filter((result) => result !== null).length, skipped: results.filter((result) => result === null).length, characterDeckName: configuration.characterDeckName, wordDeckName: configuration.wordDeckName };
}
