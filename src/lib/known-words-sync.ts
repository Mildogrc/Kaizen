// DB-facing known-words operations: Migaku imports, extraction of mature
// Anki cards into words, and recomputation of union-bound stats + goal
// progress. Union math lives in known-words.ts; normalization in lemmatize.ts.

import { prisma } from './db';
import { normalizeWord } from './lemmatize';
import { parseMigakuExport, unionBounds, type UnionEntry } from './known-words';
import { hasCompletedActiveVocabGoal } from './progression';

export type WordLanguage = 'ja' | 'zh';

const TAB_LANG: Record<string, WordLanguage> = { JAPANESE: 'ja', CHINESE: 'zh' };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface MigakuImportSummary {
  parsed: number;
  filteredOut: number;
  added: number;
  duplicates: number;
  unparseable: number;
}

export async function importMigakuWords(
  language: WordLanguage,
  text: string,
  includeLearning: boolean,
): Promise<MigakuImportSummary> {
  const result = parseMigakuExport(text, includeLearning);
  const label = `migaku import ${new Date().toISOString().slice(0, 10)}`;

  const rows = new Map<string, { surface: string; lemma: string; reading: string | null; strictKey: string; looseKey: string }>();
  let unparseable = 0;
  for (const w of result.words) {
    const normalized = await normalizeWord(language, w.word);
    if (!normalized) {
      unparseable++;
      continue;
    }
    if (!rows.has(normalized.strictKey)) rows.set(normalized.strictKey, normalized);
  }

  const created = await prisma.knownWord.createMany({
    data: [...rows.values()].map((r) => ({
      language,
      surface: r.surface,
      lemma: r.lemma,
      reading: r.reading,
      strictKey: r.strictKey,
      looseKey: r.looseKey,
      source: 'migaku',
      sourceDetail: label,
    })),
    skipDuplicates: true,
  });

  await recomputeKnownWordStats();
  return {
    parsed: result.words.length,
    filteredOut: result.filteredOut,
    added: created.count,
    duplicates: rows.size - created.count,
    unparseable,
  };
}

export interface AnkiWordsSummary {
  scanned: number;
  added: number;
  removed: number;
  unparseable: number;
}

/**
 * Mature cards from word-counting deck mappings become known words
 * (source 'anki'). Cards that lapsed out of maturity are pruned so the
 * count tracks Anki truthfully.
 */
export async function refreshAnkiKnownWords(): Promise<AnkiWordsSummary> {
  const mappings = await prisma.ankiDeckMapping.findMany({
    where: { countsKnownWords: true },
    include: { course: { select: { tab: true } } },
  });

  const summary: AnkiWordsSummary = { scanned: 0, added: 0, removed: 0, unparseable: 0 };
  const currentKeys: Record<WordLanguage, Set<string>> = { ja: new Set(), zh: new Set() };
  const newRows: {
    language: WordLanguage; surface: string; lemma: string; reading: string | null;
    strictKey: string; looseKey: string; sourceDetail: string;
  }[] = [];

  for (const mapping of mappings) {
    const language = TAB_LANG[mapping.course.tab];
    if (!language) continue;
    const cards = await prisma.ankiCardSnapshot.findMany({
      where: { mappingId: mapping.id, state: 'MATURE' },
      select: { front: true },
    });
    summary.scanned += cards.length;
    for (const card of cards) {
      const normalized = await normalizeWord(language, card.front);
      if (!normalized) {
        summary.unparseable++;
        continue;
      }
      if (currentKeys[language].has(normalized.strictKey)) continue;
      currentKeys[language].add(normalized.strictKey);
      newRows.push({ language, ...normalized, sourceDetail: mapping.deckName });
    }
  }

  const created = await prisma.knownWord.createMany({
    data: newRows.map((r) => ({ ...r, source: 'anki' })),
    skipDuplicates: true,
  });
  summary.added = created.count;

  for (const language of ['ja', 'zh'] as const) {
    const removed = await prisma.knownWord.deleteMany({
      where: { language, source: 'anki', strictKey: { notIn: [...currentKeys[language]] } },
    });
    summary.removed += removed.count;
  }

  await recomputeKnownWordStats();
  return summary;
}

export interface LanguageWordStats {
  language: WordLanguage;
  lower: number;
  upper: number;
  bySource: Record<string, number>;
  overlap: number;
}

/** Recompute union bounds per language, snapshot today's stat, update goals. */
export async function recomputeKnownWordStats(): Promise<LanguageWordStats[]> {
  const out: LanguageWordStats[] = [];
  for (const language of ['ja', 'zh'] as const) {
    const words = await prisma.knownWord.findMany({
      where: { language },
      select: { strictKey: true, looseKey: true, reading: true, source: true },
    });
    const bounds = unionBounds(words as UnionEntry[]);
    out.push({ language, ...bounds });

    await prisma.knownWordStat.upsert({
      where: { date_language: { date: startOfToday(), language } },
      create: {
        date: startOfToday(),
        language,
        lower: bounds.lower,
        upper: bounds.upper,
        migakuCount: bounds.bySource.migaku ?? 0,
        ankiCount: bounds.bySource.anki ?? 0,
        manualCount: bounds.bySource.manual ?? 0,
      },
      update: {
        lower: bounds.lower,
        upper: bounds.upper,
        migakuCount: bounds.bySource.migaku ?? 0,
        ankiCount: bounds.bySource.anki ?? 0,
        manualCount: bounds.bySource.manual ?? 0,
      },
    });

    // Vocab goals and word milestones track the conservative bound.
    const tab = language === 'ja' ? 'JAPANESE' : 'CHINESE';
    const course = await prisma.course.findFirst({
      where: { tab },
      select: {
        id: true,
        goals: {
          where: { goalType: 'vocab_count', status: 'ACTIVE' },
          select: { targetValue: true, status: true },
        },
      },
    });
    if (!course) continue;

    const completedVocabGoal = hasCompletedActiveVocabGoal(course.goals, bounds.lower);
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.courseGoal.updateMany({
        where: {
          courseId: course.id,
          goalType: 'vocab_count',
          status: 'ACTIVE',
          targetValue: { lte: bounds.lower },
        },
        data: { currentValue: bounds.lower, status: 'COMPLETED' },
      }),
      prisma.courseGoal.updateMany({
        where: {
          courseId: course.id,
          goalType: 'vocab_count',
          status: 'ACTIVE',
          OR: [{ targetValue: null }, { targetValue: { gt: bounds.lower } }],
        },
        data: { currentValue: bounds.lower },
      }),
      prisma.courseMilestone.updateMany({
        where: {
          courseId: course.id,
          metric: 'words',
          targetValue: { lte: bounds.lower },
          completedAt: null,
        },
        data: { completedAt },
      }),
    ]);

    if (completedVocabGoal) {
      const nextGoal = await prisma.courseGoal.findFirst({
        where: { courseId: course.id, status: 'PLANNED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (nextGoal) {
        await prisma.courseGoal.update({
          where: { id: nextGoal.id },
          data: { status: 'ACTIVE' },
        });
      }
    }
  }
  return out;
}

/** Lazy daily recompute for the Words page (mirrors maybeAutoSync). */
export async function maybeRecomputeStats(): Promise<void> {
  const existing = await prisma.knownWordStat.findFirst({ where: { date: startOfToday() } });
  if (!existing) await recomputeKnownWordStats().catch(() => {});
}
