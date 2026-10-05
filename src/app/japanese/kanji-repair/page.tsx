import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnCls, btnPrimaryCls } from '@/components/ui';
import { getKanjiRepairDashboard } from '@/lib/kanji-repair-data';
import { KANJI_REPAIR_DEFAULTS } from '@/lib/kanji-repair-config';
import { completeKanjiRepairAction } from './actions';

export const dynamic = 'force-dynamic';

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default async function KanjiRepairPage() {
  const dashboard = await getKanjiRepairDashboard();
  const target = dashboard.target;
  const dailyComplete = dashboard.repairsToday >= KANJI_REPAIR_DEFAULTS.dailyRepairLimit;
  const ranked = dashboard.candidates.filter((candidate) => candidate.direct.reviews > 0 || candidate.vocabulary.available).slice(0, 20);

  return (
    <>
      <PageHeader
        title="Kanji Repair"
        subtitle="One focused intervention at a time, ranked from recent Anki review evidence"
        actions={<><Link href="/configurations?section=japanese" className={btnCls}>Settings</Link><Link href="/japanese" className={btnCls}>← Japanese</Link></>}
      />

      {dashboard.source.error ? (
        <EmptyState>{dashboard.source.error}</EmptyState>
      ) : dashboard.directDeckNames.length === 0 ? (
        <EmptyState>Map and sync an RTK or kanji deck under Anki before using Kanji Repair.</EmptyState>
      ) : dailyComplete ? (
        <Card className="border-green-800/60 text-green-200">Today&apos;s Kanji Repair is complete. The next eligible target will appear tomorrow.</Card>
      ) : !target ? (
        <EmptyState>No eligible repair target currently exceeds the evidence and score thresholds.</EmptyState>
      ) : (
        <Section title="Today's repair">
          <Card>
            <div className="grid gap-5 md:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="flex h-36 items-center justify-center rounded-lg bg-surface-2 text-7xl font-semibold text-amber-200">{target.entry.kanji}</div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{target.entry.keyword ?? 'Keyword unavailable'}</h2>
                  {target.entry.rtkNumber && <Badge tone="amber">RTK #{target.entry.rtkNumber}</Badge>}
                  {target.entry.book && <Badge>Book {target.entry.book}</Badge>}
                </div>
                <p className="mt-2 text-[12px] text-muted">Selected from recent failures, smoothed lifetime performance, lapses, interval/ease, and response time. Anki scheduling is never changed.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Repair score" value={pct(target.score)} />
                  <StatCard label="Direct reviews" value={target.direct.reviews} hint={`${target.direct.again} Again · ${target.direct.hard} Hard`} />
                  <StatCard label="Recent failures" value={`${target.direct.recentFailures}/${target.direct.recentReviews}`} />
                  <StatCard label="Lifetime failure" value={pct(target.direct.lifetimeFailureRate)} hint="Bayesian-smoothed" />
                </div>
                <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-[12px]">
                  <div className="font-medium">Focused repair</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                    <li>Recall the RTK keyword before revealing it.</li>
                    <li>Write the kanji once from memory and check its components.</li>
                    <li>Repair or replace the mnemonic that caused hesitation.</li>
                    <li>Finish only when you can reproduce the kanji cleanly.</li>
                  </ol>
                </div>
                <details className="mt-3 rounded-md border border-line px-3 py-2 text-[11px] text-muted">
                  <summary className="cursor-pointer text-accent">Why this kanji was selected</summary>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <span>Ratings: {target.direct.again} Again · {target.direct.hard} Hard · {target.direct.good} Good · {target.direct.easy} Easy</span>
                    <span>Lapses: {target.direct.lapses}</span>
                    <span>Current interval: {Math.round(target.direct.intervalDays)} days</span>
                    <span>Ease: {target.direct.ease.toFixed(2)}</span>
                    <span>Average recent response: {target.direct.averageResponseMs == null ? 'unavailable' : `${(target.direct.averageResponseMs / 1000).toFixed(1)}s`}</span>
                    <span>Vocabulary-derived signal: {target.vocabulary.enabled ? target.vocabulary.available ? pct(target.vocabulary.score) : 'not enough evidence' : 'disabled'}</span>
                    <span>Last repaired: {target.repairState?.lastRepairedAt.toLocaleDateString() ?? 'never'}</span>
                    <span>Previous repairs: {target.repairState?.repairCount ?? 0}</span>
                  </div>
                </details>
                <form action={completeKanjiRepairAction} className="mt-4">
                  <input type="hidden" name="kanji" value={target.entry.kanji} />
                  <button className={btnPrimaryCls}>Mark repair complete</button>
                  <span className="ml-3 text-[11px] text-muted">Cooldown: {dashboard.configuration.cooldownDays} days</span>
                </form>
              </div>
            </div>
          </Card>
        </Section>
      )}

      <Section title="Evidence">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="RTK source" value={dashboard.source.entries.length.toLocaleString()} hint={dashboard.source.sourcePath ?? 'not loaded'} />
          <StatCard label="Direct decks" value={dashboard.directDeckNames.length} hint={dashboard.directDeckNames.join(' · ') || 'none'} />
          <StatCard label="Vocabulary signal" value={dashboard.configuration.useVocabularyPerformance ? 'On' : 'Off'} hint={dashboard.configuration.useVocabularyPerformance ? dashboard.vocabularyDeckNames.join(' · ') : 'disabled by default'} />
          <StatCard label="Last Anki sync" value={dashboard.lastSyncedAt ? dashboard.lastSyncedAt.toLocaleDateString() : '—'} />
        </div>
      </Section>

      <Section title="Ranking details">
        {ranked.length === 0 ? <EmptyState>No reviewed RTK kanji were matched to the extract.</EmptyState> : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="border-b border-line text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Kanji</th><th className="px-3 py-2">Keyword</th><th className="px-3 py-2">Reviews</th><th className="px-3 py-2">Again</th><th className="px-3 py-2">Recent</th><th className="px-3 py-2">Interval</th><th className="px-3 py-2">Vocabulary</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {ranked.map((candidate) => (
                    <tr key={candidate.entry.kanji}>
                      <td className="px-3 py-2 text-lg">{candidate.entry.kanji}</td>
                      <td className="px-3 py-2">{candidate.entry.keyword ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{candidate.direct.reviews}</td>
                      <td className="px-3 py-2 tabular-nums">{candidate.direct.again}</td>
                      <td className="px-3 py-2 tabular-nums">{candidate.direct.recentFailures}/{candidate.direct.recentReviews}</td>
                      <td className="px-3 py-2 tabular-nums">{Math.round(candidate.direct.intervalDays)}d</td>
                      <td className="px-3 py-2 tabular-nums">{candidate.vocabulary.enabled ? pct(candidate.vocabulary.score) : 'disabled'}</td>
                      <td className="px-3 py-2 tabular-nums">{pct(candidate.score)}</td>
                      <td className="px-3 py-2"><Badge tone={candidate.eligible ? 'amber' : candidate.exclusionReason === 'cooldown' ? 'blue' : 'neutral'}>{candidate.eligible ? 'eligible' : candidate.exclusionReason?.replace('-', ' ')}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {target?.vocabulary.enabled && target.vocabulary.evidence.length > 0 && (
              <details className="border-t border-line p-3">
                <summary className="cursor-pointer text-accent">Vocabulary evidence for {target.entry.kanji}</summary>
                <div className="mt-2 space-y-1 text-[11px] text-muted">
                  {target.vocabulary.evidence.map((evidence) => <div key={evidence.cardId}>{evidence.word.slice(0, 120)} · {evidence.failures}/{evidence.reviews} Again · attribution {pct(evidence.attribution)}</div>)}
                </div>
              </details>
            )}
          </Card>
        )}
      </Section>

      {dashboard.source.warnings.length > 0 && (
        <details className="mb-6 rounded-lg border border-line bg-surface p-3 text-[11px] text-muted">
          <summary className="cursor-pointer">RTK extract warnings ({dashboard.source.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{dashboard.source.warnings.slice(0, 50).map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
        </details>
      )}
    </>
  );
}
