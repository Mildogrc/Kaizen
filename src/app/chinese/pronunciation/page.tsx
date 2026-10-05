import Link from 'next/link';
import { AnkiSyncButton } from '@/components/anki-sync-button';
import { EmptyState, PageHeader, Section, btnCls } from '@/components/ui';
import { cardsInfo } from '@/lib/anki-connect';
import { prisma } from '@/lib/db';
import {
  mandarinPronunciationCandidate,
  nextToneRotationAt,
  selectTonePairGrid,
} from '@/lib/mandarin-pronunciation';
import { TonePairGrid } from './tone-pair-grid';

export const dynamic = 'force-dynamic';

export default async function MandarinPronunciationPage() {
  const now = new Date();
  const reviewedCards = await prisma.ankiCardSnapshot.findMany({
    where: {
      mapping: { course: { slug: 'chinese' } },
      reps: { gt: 0 },
      state: { in: ['LEARNING', 'YOUNG', 'MATURE'] },
    },
    select: { ankiCardId: true },
    orderBy: { ankiCardId: 'asc' },
  });

  const loadResult = await cardsInfo(reviewedCards.map((card) => Number(card.ankiCardId)))
    .then((cards) => cards.flatMap((card) => {
      const candidate = mandarinPronunciationCandidate(String(card.cardId), card.fields);
      return candidate ? [candidate] : [];
    }))
    .then((candidates) => ({ candidates, unavailable: false }))
    .catch(() => ({ candidates: [], unavailable: true }));
  const { candidates, unavailable } = loadResult;
  const entries = selectTonePairGrid(candidates, now);
  const filledPairs = Object.values(entries).filter(Boolean).length;
  const nextRotation = nextToneRotationAt(now);

  return <>
    <PageHeader
      title="Pronunciation"
      subtitle="Mandarin tone pairs drawn from vocabulary you have reviewed in Anki"
      actions={<><AnkiSyncButton /><Link href="/chinese" className={btnCls}>← Chinese</Link></>}
    />
    <Section
      title="Tone pairs"
      actions={<span className="text-[11px] text-muted">Next rotation {nextRotation.toLocaleDateString()}</span>}
    >
      {unavailable ? (
        <EmptyState>Start Anki with AnkiConnect enabled, then refresh this page to load your reviewed vocabulary and word audio.</EmptyState>
      ) : reviewedCards.length === 0 ? (
        <EmptyState>No reviewed Mandarin vocabulary is synced yet. Review cards in Anki, then use Sync Anki.</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-[12px] text-muted">{candidates.length.toLocaleString()} reviewed two-syllable words currently cover {filledPairs} of 20 tone pairs. Click any filled cell to hear its word audio. The selection changes every three days.</p>
          <TonePairGrid entries={entries} />
        </>
      )}
    </Section>
  </>;
}
