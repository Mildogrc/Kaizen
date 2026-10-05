import { addNotes, createDeck, createModel, modelNames, type AnkiNoteInput } from './anki-connect';
import { mandarinBlueprintConfiguration } from './app-settings';
import { prisma } from './db';
import { enrichMandarinBlueprintLevel, jsonStrings } from './mandarin-blueprint';
import { buildMandarinCharacterNotes, buildMandarinWordNote, MANDARIN_ANKI_MODELS } from './mandarin-anki-cards';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function ensureModels() {
  const existing = new Set(await modelNames());
  for (const model of MANDARIN_ANKI_MODELS) {
    if (!existing.has(model.modelName)) await createModel(model);
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
  await Promise.all([
    createDeck(configuration.characterDeckName),
    createDeck(configuration.reversedCharacterDeckName),
    createDeck(configuration.wordDeckName),
    ensureModels(),
  ]);
  const notes = requested.flatMap<AnkiNoteInput>(({ surface, kind }) => {
    const entry = byKey.get(`${kind}\u0000${surface}`);
    const cardEntry = {
      surface,
      traditional: entry?.traditional,
      pinyin: strings(entry?.pinyin),
      definitions: strings(entry?.definitions),
      audioUrls: strings(entry?.audioUrls),
      sourceUrl: entry?.sourceUrl,
    };
    return kind === 'CHARACTER'
      ? buildMandarinCharacterNotes(cardEntry, configuration, levelNumber)
      : [buildMandarinWordNote(cardEntry, configuration, levelNumber)];
  });
  const results = await addNotes(notes);
  await Promise.all([
    prisma.ankiDeckMapping.upsert({ where: { deckName: configuration.characterDeckName }, create: { deckName: configuration.characterDeckName, courseId: chinese.id, countsKnownWords: false }, update: { courseId: chinese.id, countsKnownWords: false } }),
    prisma.ankiDeckMapping.upsert({ where: { deckName: configuration.reversedCharacterDeckName }, create: { deckName: configuration.reversedCharacterDeckName, courseId: chinese.id, countsKnownWords: false }, update: { courseId: chinese.id, countsKnownWords: false } }),
    prisma.ankiDeckMapping.upsert({ where: { deckName: configuration.wordDeckName }, create: { deckName: configuration.wordDeckName, courseId: chinese.id, countsKnownWords: true }, update: { courseId: chinese.id, countsKnownWords: true } }),
  ]);
  return {
    requested: notes.length,
    added: results.filter((result) => result !== null).length,
    skipped: results.filter((result) => result === null).length,
    characterDeckName: configuration.characterDeckName,
    reversedCharacterDeckName: configuration.reversedCharacterDeckName,
    wordDeckName: configuration.wordDeckName,
  };
}
