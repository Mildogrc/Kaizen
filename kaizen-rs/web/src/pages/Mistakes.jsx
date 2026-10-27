import { useSearchParams } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { del, post, useApi } from '../lib/api';
import { relative } from '../lib/format';
import { attempt } from '../lib/store';
import { Icon } from '../components/icons';
import { Badge, Card, Empty, Field, Load, Page, Pills, Stat, StatGrid } from '../components/ui';

export default function Mistakes() {
  const [params, setParams] = useSearchParams();
  const q = useApi(() => `/mistakes${params.course ? `?course=${params.course}` : ''}`);
  return (
    <Load q={q}>
      {(d) => {
        const [courseId, setCourseId] = createSignal(d.courses.find((c) => c.slug === params.course)?.id ?? d.courses[0]?.id);
        const [text, setText] = createSignal('');
        const [category, setCategory] = createSignal('');
        const add = async (e) => {
          e.preventDefault();
          const r = await attempt(() => post('/mistakes', { description: text(), courseId: courseId(), category: category() || null }), 'Mistake logged');
          if (r) { setText(''); setCategory(''); }
        };
        return (
          <Page title="Mistakes" glyph="⚑" subtitle="Log errors as they happen; repeat offenders float to the top">
            <StatGrid cols="md:grid-cols-3">
              <Stat label="Open" value={d.stats.open} color={d.stats.open ? 'var(--warn)' : undefined} />
              <Stat label="Resolved" value={d.stats.resolved} />
              <Stat label="Repeated" value={d.stats.repeat} hint="seen more than once" />
            </StatGrid>
            <Card class="mb-6">
              <form onSubmit={add} class="space-y-3">
                <Field label="Area"><Pills value={courseId()} onChange={setCourseId} options={d.courses.map((c) => ({ value: c.id, label: c.name }))} /></Field>
                <div class="flex flex-wrap gap-2">
                  <input class="input min-w-[240px] flex-1" required value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder="What went wrong? e.g. confused は and が after a question word" />
                  <input class="input w-40" value={category()} onInput={(e) => setCategory(e.currentTarget.value)} placeholder="Category (optional)" />
                  <button class="btn btn-primary">Log mistake</button>
                </div>
              </form>
            </Card>
            <Pills class="mb-3" value={params.course ?? ''} onChange={(course) => setParams({ course: course || undefined })}
              options={[{ value: '', label: 'All areas' }, ...d.courses.filter((c) => c.hasMistakes).map((c) => ({ value: c.slug, label: c.name }))]} />
            <Show when={d.mistakes.length} fallback={<Empty>No mistakes logged{params.course ? ' for this area' : ''}.</Empty>}>
              <Card pad={false}>
                <div class="divide-y divide-line">
                  <For each={d.mistakes}>
                    {(m) => (
                      <div class={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${m.resolved ? 'opacity-60' : ''}`}>
                        <button class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${m.resolved ? 'border-good bg-good text-white' : 'border-line-strong hover:border-good'}`}
                          title={m.resolved ? 'Reopen' : 'Resolve'} onClick={() => attempt(() => post(`/mistakes/${m.id}/resolve`))}>{m.resolved ? '✓' : ''}</button>
                        <div class="min-w-0 flex-1">
                          <div class={`text-[13px] ${m.resolved ? 'line-through' : ''}`}>{m.description}</div>
                          <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                            <span style={{ color: m.course.color ?? undefined }}>{m.course.name}</span>
                            <Show when={m.category}><span>· {m.category}</span></Show>
                            <span>· {relative(m.updatedAt)}</span>
                          </div>
                        </div>
                        <Show when={m.count > 1}><Badge tone="warn">×{m.count}</Badge></Show>
                        <button class="btn btn-sm" onClick={() => attempt(() => post(`/mistakes/${m.id}/bump`))} title="It happened again">+1</button>
                        <button class="btn btn-ghost btn-sm text-faint" onClick={() => attempt(() => del(`/mistakes/${m.id}`))} title="Delete"><Icon name="trash" size={13} /></button>
                      </div>
                    )}
                  </For>
                </div>
              </Card>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
