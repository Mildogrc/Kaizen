import { A, useLocation } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { date, num, pct } from '../lib/format';
import { attempt } from '../lib/store';
import { AnkiSyncButton } from '../components/AnkiSync';
import { Badge, Card, Disclosure, Empty, Load, Page, Progress, Section, Stat, StatGrid, toneFor } from '../components/ui';

const TOOLS = {
  japanese: [
    { href: '/japanese/grammar', label: 'Grammar coach', glyph: '文', detail: 'AI lessons on today’s SRS queue' },
    { href: '/japanese/kanji-repair', label: 'Kanji repair', glyph: '漢', detail: 'Fix the RTK kanji you keep missing' },
  ],
  chinese: [
    { href: '/chinese/mandarin-blueprint', label: 'Mandarin Blueprint', glyph: '蓝', detail: 'Push each finished level to Anki' },
    { href: '/chinese/pronunciation', label: 'Pronunciation', glyph: '声', detail: 'Tone pairs from words you know' },
  ],
};

function ExamLevel(props) {
  const l = props.level;
  const tone = () => (l.tone === 'amber' ? 'var(--warn)' : 'var(--info)');
  return (
    <div class={`min-w-[86px] flex-1 rounded-lg border p-2.5 ${l.complete ? 'border-good/40 bg-good-soft' : 'border-line bg-surface-2/50'}`}
      title={`${l.label}: ${l.primaryLabel} ${Math.round(l.tooltipPrimary ?? l.primary)}%${l.secondary != null ? ` · Grammar ${Math.round(l.tooltipSecondary ?? l.secondary)}%` : ''} (cumulative)`}>
      <div class="flex items-center justify-between">
        <span class="text-[12.5px] font-semibold">{l.label}</span>
        <Show when={l.complete}><span class="text-[11px] text-good">✓</span></Show>
      </div>
      <Progress class="mt-2" value={l.primary} color={tone()} />
      <Show when={l.secondary != null}><Progress class="mt-1" value={l.secondary} color="#f472b6" /></Show>
      <div class="tnum mt-1 text-[10.5px] text-faint">{Math.round(l.primary)}%{l.secondary != null ? ` · ${Math.round(l.secondary)}%` : ''}</div>
    </div>
  );
}

export default function Course() {
  const location = useLocation();
  const slug = () => location.pathname.split('/')[1];
  const q = useApi(() => `/courses/${slug()}`);
  const [generating, setGenerating] = createSignal(false);

  const generate = async (courseId) => {
    setGenerating(true);
    await attempt(() => post(`/courses/${courseId}/generate-cards`), (r) =>
      `Created ${r.cardsCreated} flashcards and ${r.practiceCreated} practice items${r.ankiSkipped.length ? ` (Anki handles ${r.ankiSkipped.join(', ')})` : ''}.`);
    setGenerating(false);
  };

  return (
    <Load q={q}>
      {(d) => (
        <Page
          title={d.course.name}
          glyph={slug() === 'japanese' ? '日' : slug() === 'chinese' ? '中' : '◆'}
          subtitle={d.course.description}
          actions={
            <>
              <button class="btn" disabled={generating()} onClick={() => generate(d.course.id)}>{generating() ? 'Generating…' : 'Generate cards'}</button>
              <A href={`/import?course=${d.course.slug}`} class="btn">Import content</A>
            </>
          }
        >
          <Show when={TOOLS[slug()]}>
            <div class="mb-6 grid gap-3 sm:grid-cols-2">
              <For each={TOOLS[slug()]}>
                {(t) => (
                  <A href={t.href} class="card group flex items-center gap-3 p-4 transition-colors hover:border-accent/50">
                    <span class="flex h-11 w-11 items-center justify-center rounded-xl text-[20px] font-semibold text-white" style={{ background: d.course.color ?? 'var(--accent)' }}>{t.glyph}</span>
                    <div class="min-w-0">
                      <div class="text-[14px] font-semibold">{t.label}</div>
                      <div class="truncate text-[12px] text-muted">{t.detail}</div>
                    </div>
                    <span class="ml-auto text-faint transition-transform group-hover:translate-x-0.5">→</span>
                  </A>
                )}
              </For>
            </div>
          </Show>

          <StatGrid cols={d.anki ? 'md:grid-cols-5' : 'md:grid-cols-4'}>
            <Stat label="Content items" value={num(d.stats.items)} hint="stored in Kaizen" color={d.course.color} />
            <Stat label="App flashcards" value={num(d.stats.flashcards)} hint="excludes Anki" />
            <Show when={d.anki}><Stat label="Anki cards" value={num(d.anki.cards)} hint={d.anki.lastSyncedAt ? `synced ${date(d.anki.lastSyncedAt)}` : 'never synced'} /></Show>
            <Stat label="App due" value={num(d.stats.dueReviews)} href="/review" />
            <Stat label="Open mistakes" value={num(d.stats.mistakes)} href={`/mistakes?course=${d.course.slug}`} />
          </StatGrid>

          <Show when={d.anki}>
            {(a) => (
              <Card class="mb-6">
                <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
                  <span class="font-semibold">★ Anki</span>
                  <span>due today <b class="tnum">{num(a().dueToday)}</b></span>
                  <span>streak <b class="tnum">{a().streak}d</b></span>
                  <span>mature retention <b class="tnum">{pct(a().matureRetention)}</b></span>
                  <span>mature <b class="tnum">{a().maturePct}%</b></span>
                  <Show when={d.knownWords}>
                    <A href="/words" class="hover:underline">known words <b class="tnum text-info">{d.knownWords.lowerBound === d.knownWords.upperBound ? num(d.knownWords.lowerBound) : `${num(d.knownWords.lowerBound)}–${num(d.knownWords.upperBound)}`}</b></A>
                  </Show>
                  <Show when={slug() === 'japanese'}><span>kanji <b class="tnum text-warn">{num(d.matureKanji)}</b></span></Show>
                  <span class="ml-auto flex items-center gap-2">
                    <AnkiSyncButton small />
                    <A href={`/analytics?area=${slug()}`} class="btn btn-sm">Analytics</A>
                  </span>
                </div>
                <div class="mt-1.5 text-[11px] text-faint">{a().deckNames.join(' · ')}</div>
              </Card>
            )}
          </Show>

          <Section title="Current goal">
            <Show when={slug() === 'japanese'} fallback={
              <Show when={d.goals.length} fallback={<Empty>No goals yet.</Empty>}>
                <div class="grid gap-3 md:grid-cols-2">
                  <For each={d.goals}>
                    {(g) => (
                      <Card class={g.status === 'PLANNED' ? 'opacity-70' : ''}>
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-[13px] font-semibold">{g.title}</span>
                          <Badge tone={toneFor(g.status)}>{g.status.toLowerCase()}</Badge>
                        </div>
                        <Show when={g.targetValue}>
                          <Progress class="mt-3" value={(g.currentValue / g.targetValue) * 100} color={d.course.color} />
                          <div class="tnum mt-1.5 text-[11.5px] text-muted">{num(g.currentValue)} / {num(g.targetValue)} {g.unit}</div>
                        </Show>
                        <Show when={g.description}><p class="mt-1.5 text-[12px] text-muted">{g.description}</p></Show>
                        <Show when={g.status === 'ACTIVE' && !g.targetValue}>
                          <button class="btn btn-sm mt-2" onClick={() => attempt(() => post(`/goals/${g.id}/complete`), 'Goal completed')}>Mark complete</button>
                        </Show>
                      </Card>
                    )}
                  </For>
                </div>
              </Show>
            }>
              <Show when={d.japaneseGoal} fallback={<Card class="border-good/40 text-good">JLPT N5–N1 vocabulary and grammar complete.</Card>}>
                {(g) => (
                  <Card class="max-w-xl">
                    <div class="flex items-center justify-between"><span class="text-[13px] font-semibold">Prepare for JLPT {g().name}</span><Badge tone="accent">active</Badge></div>
                    <div class="mt-3 grid grid-cols-2 gap-4 text-[11px] text-muted">
                      <div><div class="mb-1 flex justify-between"><span>Words</span><span class="tnum">{Math.round(g().wordProgress)}%</span></div><Progress value={g().wordProgress} color="var(--info)" /></div>
                      <div><div class="mb-1 flex justify-between"><span>Grammar</span><span class="tnum">{Math.round(g().grammarProgress)}%</span></div><Progress value={g().grammarProgress} color="#f472b6" /></div>
                    </div>
                    <p class="tnum mt-2 text-[12px] text-muted">{num(g().wordsRemaining)} words · {num(g().grammarRemaining)} grammar points left</p>
                  </Card>
                )}
              </Show>
            </Show>
          </Section>

          <Show when={d.exams.length}>
            <Section title="Exam tracks">
              <div class="space-y-3">
                <For each={d.exams}>
                  {(exam) => (
                    <Card>
                      <div class="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                        <span class="text-[13px] font-semibold">{exam.name}</span>
                        <span class="text-[11.5px] text-muted">{exam.description}</span>
                      </div>
                      <div class="flex flex-wrap gap-2"><For each={exam.levels}>{(l) => <ExamLevel level={l} />}</For></div>
                    </Card>
                  )}
                </For>
              </div>
            </Section>
          </Show>

          <Show when={slug() !== 'japanese' && d.milestones.length}>
            <Section title="Milestones">
              <Card pad={false}>
                <ol class="divide-y divide-line">
                  <For each={d.milestones}>
                    {(m) => (
                      <li class="flex items-center gap-3 px-4 py-2.5">
                        <span class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${m.completedAt ? 'bg-good text-white' : 'bg-surface-3 text-muted'}`}>{m.completedAt ? '✓' : m.order}</span>
                        <span class="flex-1 text-[13px]">{m.title}</span>
                        <Show when={m.targetValue != null}><span class="tnum text-[11.5px] text-muted">{num(m.targetValue)} {m.metric}</span></Show>
                      </li>
                    )}
                  </For>
                </ol>
              </Card>
            </Section>
          </Show>

          <div class="grid gap-3 md:grid-cols-2">
            <Disclosure title={<>Content databases <span class="text-muted">({d.schemas.length})</span></>}>
              <div class="space-y-1.5">
                <For each={d.schemas}>
                  {(s) => (
                    <A href={`/schemas/${s.slug}`} class="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-2">
                      <div><div class="text-[13px] font-medium">{s.name}</div><div class="font-mono text-[11px] text-faint">{s.itemType}</div></div>
                      <span class="tnum text-[15px] font-semibold text-muted">{num(s.items)}</span>
                    </A>
                  )}
                </For>
              </div>
            </Disclosure>
            <Disclosure title={<>Recent imports <span class="text-muted">({d.imports.length})</span></>}>
              <Show when={d.imports.length} fallback={<p class="text-[12.5px] text-muted">Nothing imported yet. <A class="text-accent-text underline" href={`/import?course=${d.course.slug}`}>Import JSON</A> generated by the AI.</p>}>
                <div class="space-y-1.5">
                  <For each={d.imports}>
                    {(b) => (
                      <div class="flex items-center justify-between gap-2 text-[12.5px]">
                        <span>{b.sourceName ?? 'import'} · <span class="tnum">{b.validCount}/{b.totalCount}</span></span>
                        <span class="flex items-center gap-2"><Badge tone={b.status === 'COMPLETED' ? 'good' : 'warn'}>{b.status.toLowerCase()}</Badge><span class="text-faint">{date(b.createdAt)}</span></span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Disclosure>
          </div>
        </Page>
      )}
    </Load>
  );
}
