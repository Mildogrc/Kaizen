// Pulls mapped decks from AnkiConnect into Postgres snapshots. Cards are
// upserted (and pruned when removed from the deck); review logs are appended
// incrementally keyed on Anki's revlog id.

import { prisma } from './db';
import { stripAnkiHtml } from './anki-html';
import { nestedDeckFallback } from './anki-deck';
import {
  AnkiUnavailableError,
  cardReviews,
  cardsInfo,
  deckNames,
  findCards,
  notesInfoTags,
  type AnkiCardInfo,
} from './anki-connect';

const DAY_MS = 86_400_000;

type CardState = 'NEW' | 'LEARNING' | 'YOUNG' | 'MATURE' | 'SUSPENDED' | 'BURIED';

function stateFor(card: AnkiCardInfo): CardState {
  if (card.queue === -1) return 'SUSPENDED';
  if (card.queue === -2 || card.queue === -3) return 'BURIED';
  if (card.queue === 0) return 'NEW';
  if (card.queue === 1 || card.queue === 3) return 'LEARNING';
  return card.interval >= 21 ? 'MATURE' : 'YOUNG';
}

/** Interval in days; Anki stores sub-day intervals as negative seconds. */
function intervalDays(card: AnkiCardInfo): number {
  return card.interval >= 0 ? card.interval : 0;
}

/** Meaningful field texts in template order (skips empty and pure-numeric). */
function fieldTexts(card: AnkiCardInfo): string[] {
  return Object.values(card.fields)
    .sort((a, b) => a.order - b.order)
    .map((f) => stripAnkiHtml(f.value))
    .filter((v) => v.length > 0 && !/^\d+$/.test(v));
}

/**
 * Readable front/back. Some templates render an audio-only front (or back),
 * so fall back to note fields when the rendered side strips to nothing.
 */
function cardText(card: AnkiCardInfo): { front: string; back: string } {
  let front = stripAnkiHtml(card.question);
  let back = stripAnkiHtml(card.answer);
  const fields = fieldTexts(card);
  if (!front) front = fields[0] ?? '(audio-only card)';
  if (back.startsWith(front)) back = back.slice(front.length).replace(/^[\s·—-]+/, '');
  if (!back) back = fields.slice(1, 4).join(' — ');
  return { front: front.slice(0, 500), back: back.slice(0, 1000) };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Review-queue cards report `due` as a day number relative to the collection
 * creation day, which AnkiConnect does not expose directly. Derive today's
 * day number once per sync by probing a card with a known relative due date
 * (`prop:due=N` means due in N days).
 */
async function probeTodayDayNumber(): Promise<number | null> {
  for (const rel of [0, -1, 1, -3, 3, -7, 7, -30, 30]) {
    const ids = await findCards(`prop:due=${rel} -is:learn`);
    if (ids.length === 0) continue;
    const [info] = await cardsInfo(ids.slice(0, 1));
    if (info && info.queue === 2) return info.due - rel;
  }
  return null;
}

function dueAtFor(card: AnkiCardInfo, todayDayNumber: number | null): Date | null {
  const state = stateFor(card);
  if (state === 'NEW' || state === 'SUSPENDED' || state === 'BURIED') return null;
  if (card.queue === 1) {
    // intraday learning: due is epoch seconds
    return card.due > 1_000_000_000 ? new Date(card.due * 1000) : startOfToday();
  }
  // review / day-learning: due is a day number
  if (todayDayNumber === null) return null;
  return new Date(startOfToday().getTime() + (card.due - todayDayNumber) * DAY_MS);
}

export interface SyncSummary {
  ok: boolean;
  error?: string;
  decksSynced: number;
  cardsSynced: number;
  reviewsAdded: number;
}

export async function syncAnki(): Promise<SyncSummary> {
  const run = await prisma.ankiSyncRun.create({ data: {} });
  const summary: SyncSummary = { ok: true, decksSynced: 0, cardsSynced: 0, reviewsAdded: 0 };

  try {
    const mappings = await prisma.ankiDeckMapping.findMany();
    const availableDeckNames = await deckNames();
    const todayDayNumber = await probeTodayDayNumber();

    for (const mapping of mappings) {
      let resolvedDeckName = mapping.deckName;
      let escapedDeckName = resolvedDeckName.replace(/"/g, '\\"');
      let cardIds = await findCards(`deck:"${escapedDeckName}"`);
      if (cardIds.length === 0) {
        const fallback = nestedDeckFallback(mapping.deckName, availableDeckNames);
        if (fallback) {
          resolvedDeckName = fallback;
          escapedDeckName = fallback.replace(/"/g, '\\"');
          cardIds = await findCards(`deck:"${escapedDeckName}"`);
        }
      }
      const cards = await cardsInfo(cardIds);
      const tagsByNote = await notesInfoTags([...new Set(cards.map((c) => c.note))]);

      const existingSnapshotCount = await prisma.ankiCardSnapshot.count({ where: { mappingId: mapping.id } });
      if (cards.length === 0 && existingSnapshotCount > 0) continue;

      // Prune snapshots for cards no longer in the deck.
      await prisma.ankiCardSnapshot.deleteMany({
        where: { mappingId: mapping.id, ankiCardId: { notIn: cards.map((c) => BigInt(c.cardId)) } },
      });

      for (let i = 0; i < cards.length; i += 100) {
        const chunk = cards.slice(i, i + 100);
        await prisma.$transaction(
          chunk.map((card) => {
            const text = cardText(card);
            const data = {
              mappingId: mapping.id,
              front: text.front,
              back: text.back,
              state: stateFor(card),
              intervalDays: intervalDays(card),
              ease: card.factor > 0 ? card.factor / 1000 : 2.5,
              dueAt: dueAtFor(card, todayDayNumber),
              reps: card.reps,
              lapses: card.lapses,
              isLeech: (tagsByNote.get(card.note) ?? []).includes('leech') || card.lapses >= 8,
            };
            return prisma.ankiCardSnapshot.upsert({
              where: { ankiCardId: BigInt(card.cardId) },
              create: { ...data, ankiCardId: BigInt(card.cardId) },
              update: data,
            });
          }),
        );
      }
      summary.cardsSynced += cards.length;

      // Incremental review history.
      const latest = await prisma.ankiReviewLog.aggregate({
        where: { mappingId: mapping.id },
        _max: { ankiReviewId: true },
      });
      const startID = Number(latest._max.ankiReviewId ?? 0n);
      const reviews = await cardReviews(resolvedDeckName, startID);
      if (reviews.length > 0) {
        const result = await prisma.ankiReviewLog.createMany({
          data: reviews.map(([reviewTime, cardID, , buttonPressed, newInterval, previousInterval, , duration]) => ({
            ankiReviewId: BigInt(reviewTime),
            mappingId: mapping.id,
            ankiCardId: BigInt(cardID),
            reviewedAt: new Date(reviewTime),
            rating: buttonPressed,
            intervalAfterDays: newInterval >= 0 ? newInterval : 0,
            intervalBeforeDays: previousInterval >= 0 ? previousInterval : 0,
            timeMs: duration,
          })),
          skipDuplicates: true,
        });
        summary.reviewsAdded += result.count;
      }

      await prisma.ankiDeckMapping.update({
        where: { id: mapping.id },
        data: { lastSyncedAt: new Date() },
      });
      summary.decksSynced += 1;
    }

    await prisma.ankiSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'ok',
        decksSynced: summary.decksSynced,
        cardsSynced: summary.cardsSynced,
        reviewsAdded: summary.reviewsAdded,
      },
    });

    // Mature-card set may have shifted — keep the known-word count in step.
    const { refreshAnkiKnownWords } = await import('./known-words-sync');
    await refreshAnkiKnownWords().catch(() => {});
  } catch (e) {
    summary.ok = false;
    summary.error = e instanceof AnkiUnavailableError ? e.message : (e as Error).message;
    await prisma.ankiSyncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'error', error: summary.error },
    });
  }
  return summary;
}

/** Auto-sync helper: sync at most once per hour, silently skipping when idle. */
export async function maybeAutoSync(): Promise<void> {
  const lastOk = await prisma.ankiSyncRun.findFirst({
    where: { status: 'ok' },
    orderBy: { startedAt: 'desc' },
  });
  if (lastOk && Date.now() - lastOk.startedAt.getTime() < 60 * 60 * 1000) return;
  const mappingCount = await prisma.ankiDeckMapping.count();
  if (mappingCount === 0) return;
  await syncAnki();
}
