import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { ai } from '../lib/ai';
import { post, useApi } from '../lib/api';
import { date, num, pct } from '../lib/format';
import { attempt } from '../lib/store';
import { Icon } from '../components/icons';
import { Badge, Card, Disclosure, Empty, Load, Page, Section, Stat, StatGrid, Table } from '../components/ui';

export default function KanjiRepair() {
  const q = useApi(() => '/japanese/kanji-repair');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Kanji repair" glyph="漢" back={{ href: '/japanese', label: 'Japanese' }}
          subtitle="One focused intervention a day, ranked from your recent Anki reviews. Anki scheduling is never changed."
          actions={<A href="/configurations?section=japanese" class="btn">Settings</A>}>
          <Show when={!d.source.error} fallback={<Empty>{d.source.error}</Empty>}>
            <Show when={d.directDecks.length} fallback={<Empty>Map and sync an RTK or kanji deck on the <A class="text-accent-text underline" href="/anki">Anki page</A> first.</Empty>}>
              <Show when={!d.dailyComplete} fallback={<Card class="mb-6 border-good/40 bg-good-soft text-good">Today’s kanji repair is done. The next target appears tomorrow.</Card>}>
                <Show when={d.target} fallback={<Empty class="mb-6">No kanji currently exceeds the evidence and score thresholds. Nice.</Empty>}>
                  {(t) => {
                    const c = () => t().candidate;
                    return (
                      <Section title="Today’s repair">
                        <Card>
                          <div class="grid gap-5 md:grid-cols-[9rem_minmax(0,1fr)]">
                            <div class="flex h-36 items-center justify-center rounded-xl bg-warn-soft text-[72px] font-semibold text-warn">{c().entry.kanji}</div>
                            <div>
                              <div class="flex flex-wrap items-center gap-2">
                                <h2 class="text-[20px] font-semibold">{c().entry.keyword ?? 'Keyword unavailable'}</h2>
                                <Show when={c().entry.rtkNumber}><Badge tone="warn">RTK #{c().entry.rtkNumber}</Badge></Show>
                                <Show when={c().entry.book}><Badge>Book {c().entry.book}</Badge></Show>
                              </div>
                              <div class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                <Stat label="Repair score" value={pct(c().score)} />
                                <Stat label="Reviews" value={c().direct.reviews} hint={`${c().direct.again} Again · ${c().direct.hard} Hard`} />
                                <Stat label="Recent fails" value={`${c().direct.recentFailures}/${c().direct.recentReviews}`} />
                                <Stat label="Lifetime fail" value={pct(c().direct.lifetimeFailureRate)} hint="smoothed" />
                              </div>
                              <ol class="mt-4 list-decimal space-y-1 rounded-lg border border-line bg-surface-2/60 py-3 pl-8 pr-3 text-[12.5px] text-muted">
                                <li>Recall the keyword before revealing it.</li>
                                <li>Write the kanji once from memory and check its components.</li>
                                <li>Repair or replace the mnemonic that caused hesitation.</li>
                                <li>Finish only when you can reproduce it cleanly.</li>
                              </ol>
                              <div class="mt-4 flex flex-wrap items-center gap-2">
                                <button class="btn btn-primary" onClick={() => attempt(() => post('/japanese/kanji-repair/complete', { kanji: c().entry.kanji }), 'Repair recorded')}>Mark repair complete</button>
                                <button class="btn" onClick={() => ai.ask({ kind: 'kanji-mnemonic', ref: c().entry.kanji, title: `Mnemonic for ${c().entry.kanji}`, prompt: t().mnemonicPrompt })}>
                                  <Icon name="sparkle" size={14} /> Rebuild mnemonic with AI
                                </button>
                                <span class="text-[11.5px] text-muted">Cooldown {d.config.cooldownDays} days</span>
                              </div>
                              <div class="mt-3">
                                <Disclosure title="Why this kanji">
                                  <div class="grid gap-1 text-[12px] text-muted sm:grid-cols-2">
                                    <span>Ratings: {c().direct.again} Again · {c().direct.hard} Hard · {c().direct.good} Good · {c().direct.easy} Easy</span>
                                    <span>Lapses: {c().direct.lapses}</span>
                                    <span>Interval: {Math.round(c().direct.intervalDays)} days</span>
                                    <span>Ease: {c().direct.ease.toFixed(2)}</span>
                                    <span>Avg response: {c().direct.averageResponseMs == null ? '—' : `${(c().direct.averageResponseMs / 1000).toFixed(1)}s`}</span>
                                    <span>Vocabulary signal: {c().vocabulary.enabled ? (c().vocabulary.available ? pct(c().vocabulary.score) : 'not enough evidence') : 'off'}</span>
                                    <span>Last repaired: {c().repairState ? date(c().repairState.lastRepairedAt) : 'never'}</span>
                                    <span>Previous repairs: {c().repairState?.repairCount ?? 0}</span>
                                  </div>
                                </Disclosure>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </Section>
                    );
                  }}
                </Show>
              </Show>
            </Show>
          </Show>

          <StatGrid>
            <Stat label="RTK kanji" value={num(d.source.entries)} hint="bundled extract" />
            <Stat label="Kanji decks" value={d.directDecks.length} hint={d.directDecks.join(' · ') || 'none'} />
            <Stat label="Vocabulary signal" value={d.config.useVocabularyPerformance ? 'On' : 'Off'} hint={d.config.useVocabularyPerformance ? d.vocabularyDecks.join(' · ') : 'off by default'} />
            <Stat label="Last Anki sync" value={d.lastSyncedAt ? date(d.lastSyncedAt) : '—'} />
          </StatGrid>

          <Section title="Ranking">
            <Show when={d.ranked.length} fallback={<Empty>No reviewed RTK kanji matched the extract yet.</Empty>}>
              <Table rows={d.ranked} columns={[
                { label: 'Kanji', render: (c) => <span class="text-[18px]">{c.entry.kanji}</span> },
                { label: 'Keyword', render: (c) => c.entry.keyword ?? '—' },
                { label: 'Reviews', align: 'right', render: (c) => c.direct.reviews },
                { label: 'Again', align: 'right', render: (c) => c.direct.again },
                { label: 'Recent', align: 'right', render: (c) => `${c.direct.recentFailures}/${c.direct.recentReviews}` },
                { label: 'Interval', align: 'right', render: (c) => `${Math.round(c.direct.intervalDays)}d` },
                { label: 'Score', align: 'right', render: (c) => pct(c.score) },
                { label: 'Status', render: (c) => <Badge tone={c.eligible ? 'warn' : c.exclusionReason === 'cooldown' ? 'info' : 'neutral'}>{c.eligible ? 'eligible' : c.exclusionReason?.replace('-', ' ')}</Badge> },
              ]} />
            </Show>
          </Section>
          <Show when={d.source.warnings.length}>
            <Disclosure title={`Extract warnings (${d.source.warnings.length})`}>
              <ul class="list-disc space-y-1 pl-5 text-[11.5px] text-muted"><For each={d.source.warnings}>{(w) => <li>{w}</li>}</For></ul>
            </Disclosure>
          </Show>
        </Page>
      )}
    </Load>
  );
}
