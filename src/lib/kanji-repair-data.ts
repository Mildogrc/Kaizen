import { ankiRowsForMappings } from './anki-data';
import type { SnapshotRow } from './anki-analytics';
import { japaneseKanjiRepairConfiguration, type JapaneseKanjiRepairConfiguration } from './app-settings';
import { prisma } from './db';
import { loadKanjiExtract, type KanjiExtractResult } from './kanji-extract';
import {
  extractKanjiCharacters,
  isDirectKanjiDeckName,
  scoreKanjiRepairCandidates,
  selectKanjiRepairTarget,
  type KanjiRepairCandidate,
  type KanjiRepairEvidenceCard,
} from './kanji-repair';
import { KANJI_REPAIR_DEFAULTS } from './kanji-repair-config';

export interface KanjiRepairDashboard {
  source: KanjiExtractResult;
  configuration: JapaneseKanjiRepairConfiguration;
  candidates: KanjiRepairCandidate[];
  target: KanjiRepairCandidate | null;
  repairsToday: number;
  directDeckNames: string[];
  vocabularyDeckNames: string[];
  lastSyncedAt: Date | null;
  userId: string | null;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function matchingKanji(snapshot: SnapshotRow, knownKanji: Set<string>, direct: boolean): string[] {
  const frontMatches = extractKanjiCharacters(snapshot.front).filter((kanji) => knownKanji.has(kanji));
  if (!direct) return frontMatches;
  if (frontMatches.length === 1) return frontMatches;
  const backMatches = extractKanjiCharacters(snapshot.back).filter((kanji) => knownKanji.has(kanji));
  return backMatches.length === 1 ? backMatches : [];
}

function evidenceCards(
  snapshots: SnapshotRow[],
  logsByCard: Map<string, Awaited<ReturnType<typeof ankiRowsForMappings>>['logs']>,
  mappingIds: Set<string>,
  knownKanji: Set<string>,
  direct: boolean,
): KanjiRepairEvidenceCard[] {
  return snapshots.flatMap((snapshot) => {
    if (!snapshot.mappingId || !mappingIds.has(snapshot.mappingId)) return [];
    const kanji = matchingKanji(snapshot, knownKanji, direct);
    if (kanji.length === 0) return [];
    return [{
      ankiCardId: snapshot.ankiCardId,
      label: snapshot.front,
      kanji,
      intervalDays: snapshot.intervalDays,
      ease: snapshot.ease,
      lapses: snapshot.lapses,
      logs: logsByCard.get(snapshot.ankiCardId) ?? [],
    }];
  });
}

export async function getKanjiRepairDashboard(now: Date = new Date()): Promise<KanjiRepairDashboard> {
  const source = await loadKanjiExtract();
  const user = await prisma.user.findFirst({ select: { id: true, settings: true } });
  const configuration = japaneseKanjiRepairConfiguration(user?.settings);
  const empty = {
    source,
    configuration,
    candidates: [],
    target: null,
    repairsToday: 0,
    directDeckNames: [],
    vocabularyDeckNames: [],
    lastSyncedAt: null,
    userId: user?.id ?? null,
  } satisfies KanjiRepairDashboard;
  if (source.error || source.entries.length === 0 || !user) return empty;

  const course = await prisma.course.findUnique({ where: { slug: 'japanese' }, select: { id: true } });
  if (!course) return empty;
  const mappings = await prisma.ankiDeckMapping.findMany({
    where: { courseId: course.id },
    select: { id: true, deckName: true, lastSyncedAt: true },
  });
  const directMappings = mappings.filter((mapping) => isDirectKanjiDeckName(mapping.deckName));
  const vocabularyMappings = mappings.filter((mapping) => !isDirectKanjiDeckName(mapping.deckName));
  const { snapshots, logs } = await ankiRowsForMappings(mappings.map((mapping) => mapping.id));
  const logsByCard = new Map<string, typeof logs>();
  for (const log of logs) logsByCard.set(log.ankiCardId, [...(logsByCard.get(log.ankiCardId) ?? []), log]);
  const knownKanji = new Set(source.entries.map((entry) => entry.kanji));
  const directCards = evidenceCards(snapshots, logsByCard, new Set(directMappings.map((mapping) => mapping.id)), knownKanji, true);
  const vocabularyCards = configuration.useVocabularyPerformance
    ? evidenceCards(snapshots, logsByCard, new Set(vocabularyMappings.map((mapping) => mapping.id)), knownKanji, false)
    : [];
  const states = await prisma.kanjiRepairState.findMany({ where: { userId: user.id } });
  const candidates = scoreKanjiRepairCandidates({
    entries: source.entries,
    directCards,
    vocabularyCards,
    repairStates: states,
    useVocabularyPerformance: configuration.useVocabularyPerformance,
    now,
  });
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const repairsToday = states.filter((state) => state.lastRepairedAt >= today && state.lastRepairedAt < tomorrow).length;
  const target = repairsToday >= KANJI_REPAIR_DEFAULTS.dailyRepairLimit ? null : selectKanjiRepairTarget(candidates);
  const lastSyncedAt = mappings.reduce<Date | null>((latest, mapping) => {
    if (!mapping.lastSyncedAt) return latest;
    return !latest || mapping.lastSyncedAt > latest ? mapping.lastSyncedAt : latest;
  }, null);

  return {
    source,
    configuration,
    candidates,
    target,
    repairsToday,
    directDeckNames: directMappings.map((mapping) => mapping.deckName),
    vocabularyDeckNames: vocabularyMappings.map((mapping) => mapping.deckName),
    lastSyncedAt,
    userId: user.id,
  };
}
