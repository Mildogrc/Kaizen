import { A, useSearchParams } from '@solidjs/router';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { api, invalidate, put, useApi } from '../lib/api';
import { attempt } from '../lib/store';
import { RoadmapLegend, RoadmapTree } from '../components/RoadmapTree';
import { Card, Load, Page, Progress, Section, Stat, StatGrid, Toggle, cx } from '../components/ui';

export default function MathPage() {
  const [params, setParams] = useSearchParams();
  const q = useApi(() => '/math');
  return (
    <Load q={q}>
      {(d) => {
        const [overrides, setOverrides] = createSignal({});
        const [progress, setProgress] = createSignal(null);
        const [hideAdvanced, setHideAdvanced] = createSignal(false);
        const live = () => progress() ?? d.progress;
        const status = (id) => overrides()[id] ?? live().statuses[id];
        const target = () => (params.target === 'all' ? null : params.target ?? d.initialTarget ?? null);
        const targets = createMemo(() => d.nodes.filter((n) => n.isTarget));
        const view = createMemo(() => {
          const t = target();
          if (t && d.views.targets[t]) return d.views.targets[t];
          return { layers: hideAdvanced() ? d.views.core : d.views.full, order: null };
        });
        const byId = createMemo(() => new Map(d.nodes.map((n) => [n.id, n])));
        const doneIn = (ids) => ids.filter((id) => status(id) === 'COMPLETED').length;

        const cycle = async (node) => {
          const order = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
          const next = order[(order.indexOf(status(node.id)) + 1) % order.length];
          setOverrides((o) => ({ ...o, [node.id]: next }));
          try {
            const r = await api(`/roadmap/nodes/${node.id}/cycle`, { method: 'POST' });
            setProgress(r.progress);
            setOverrides((o) => { const c = { ...o }; delete c[node.id]; return c; });
            invalidate((k) => k !== '/math');
          } catch (err) {
            setOverrides((o) => { const c = { ...o }; delete c[node.id]; return c; });
            attempt(() => Promise.reject(err));
          }
        };
        const makeCurrent = (slug) => attempt(() => put('/math/goal', { targetSlug: slug }), 'Current goal updated');

        return (
          <Page title="Mathematics" glyph="∑" subtitle={d.course.description}
            actions={<><A href="/configurations?section=math" class="btn">Long-term goals</A><A href="/import?course=math" class="btn">Import content</A></>}>
            <StatGrid>
              <Stat label="Courses completed" value={`${live().full.done}/${live().full.total}`} />
              <Stat label="In progress" value={Object.values(live().statuses).filter((s) => s === 'IN_PROGRESS').length} />
              <Stat label="Learning items" value={d.stats.items} />
              <Stat label="Open mistakes" value={d.stats.mistakes} href="/mistakes?course=math" />
            </StatGrid>

            <Show when={d.current}>
              {(c) => {
                const p = () => live().targets[c().slug];
                return (
                  <Section title="Current goal">
                    <Card class="max-w-xl">
                      <div class="flex items-center justify-between"><span class="text-[14px] font-semibold">Path to {c().title}</span><span class="tnum text-[13px] font-semibold">{p()?.pct ?? 0}%</span></div>
                      <Progress class="mt-2.5" value={p()?.pct ?? 0} />
                      <div class="tnum mt-1.5 text-[12px] text-muted">{p()?.done ?? 0} of {p()?.total ?? 0} courses complete</div>
                    </Card>
                  </Section>
                );
              }}
            </Show>

            <Section title="Roadmap">
              <div class="mb-3 flex flex-wrap items-center gap-1.5">
                <button class="pill relative overflow-hidden" aria-pressed={!target()} onClick={() => setParams({ target: 'all' })}>
                  <span class="absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${(live().full.done / Math.max(1, live().full.total)) * 100}%` }} />
                  <span class="relative">Full roadmap</span>
                </button>
                <For each={targets()}>
                  {(t) => (
                    <button class="pill relative overflow-hidden" aria-pressed={target() === t.slug} onClick={() => setParams({ target: t.slug })}
                      title={`${t.title}: ${live().targets[t.slug]?.pct ?? 0}% complete`}>
                      <span class="absolute inset-y-0 left-0 bg-warn/20" style={{ width: `${live().targets[t.slug]?.pct ?? 0}%` }} />
                      <span class="relative">{t.title}</span>
                      <span class="tnum relative text-faint">{live().targets[t.slug]?.pct ?? 0}%</span>
                    </button>
                  )}
                </For>
                <Show when={!target()}><Toggle class="ml-2 text-muted" label="Hide advanced" checked={hideAdvanced()} onChange={setHideAdvanced} /></Show>
              </div>
              <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <RoadmapLegend />
                <span class="tnum text-[11.5px] text-muted">
                  {doneIn(view().layers.flat())}/{view().layers.flat().length} completed in view · click to cycle · hover to trace
                </span>
              </div>
              <RoadmapTree nodes={d.nodes} edges={d.edges} layers={view().layers} ancestors={d.ancestors} ready={live().ready} status={status} onCycle={cycle} />
              <Show when={target() && view().order}>
                <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Card>
                    <div class="mb-2 text-[13px] font-semibold">Study order for {byId().get(view().order.at(-1))?.title}</div>
                    <ol class="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                      <For each={view().order}>
                        {(id, i) => (
                          <li class="flex items-center gap-2 text-[12.5px]">
                            <span class="tnum w-5 text-right text-[11px] text-faint">{i() + 1}.</span>
                            <span class={cx('h-1.5 w-1.5 shrink-0 rounded-full', status(id) === 'COMPLETED' ? 'bg-good' : status(id) === 'IN_PROGRESS' ? 'bg-info' : 'bg-faint')} />
                            <span class={status(id) === 'COMPLETED' ? 'text-muted line-through' : ''}>{byId().get(id)?.title}</span>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Card>
                  <Show when={d.current?.slug !== target()}>
                    <div><button class="btn btn-primary" onClick={() => makeCurrent(target())}>Make this my current goal</button></div>
                  </Show>
                </div>
              </Show>
            </Section>
          </Page>
        );
      }}
    </Load>
  );
}
