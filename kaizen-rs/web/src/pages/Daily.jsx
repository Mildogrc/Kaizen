import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { post, useApi } from '../lib/api';
import { date } from '../lib/format';
import { attempt } from '../lib/store';
import { Load, Page, Progress } from '../components/ui';

export default function Daily() {
  const q = useApi(() => '/daily');
  const toggleMeditation = (complete) => attempt(() => post('/daily/meditation', { complete }));
  return (
    <Load q={q}>
      {(d) => {
        const total = () => d.queue.length + 1;
        const done = () => d.queue.filter((x) => x.complete).length + (d.meditation.complete ? 1 : 0);
        return (
          <Page title="Daily" subtitle={`${date(d.date, { weekday: 'long', month: 'long', day: 'numeric' })} · meditate, review, and read`}>
            <div class="mx-auto max-w-2xl">
              <div class="mb-5">
                <div class="mb-1.5 flex justify-between text-[12px] text-muted"><span>{done()} of {total()} done</span><span class="tnum">{Math.round((done() / total()) * 100)}%</span></div>
                <Progress value={(done() / total()) * 100} color="var(--good)" />
              </div>
              <ol class="space-y-2.5">
                <li class="card flex items-center gap-4 p-4">
                  <button
                    class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[13px] transition-colors ${d.meditation.complete ? 'border-good bg-good text-white' : 'border-line-strong hover:border-good'}`}
                    onClick={() => toggleMeditation(!d.meditation.complete)}
                    aria-label={d.meditation.complete ? 'Mark meditation not done' : 'Mark meditation done'}
                  >{d.meditation.complete ? '✓' : ''}</button>
                  <div class="flex-1">
                    <div class={`text-[14px] font-semibold ${d.meditation.complete ? 'text-muted line-through' : ''}`}>Meditate</div>
                    <div class="text-[12px] text-muted">{d.meditation.minutes} minutes · tap the circle when you’re done</div>
                  </div>
                  <A href="/analytics?area=meditation" class="text-[12px] text-accent-text hover:underline">History</A>
                </li>
                <For each={d.queue}>
                  {(item) => (
                    <li>
                      <A href={item.href} class="card flex items-center gap-4 p-4 transition-colors hover:border-line-strong">
                        <span class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[13px] ${item.complete ? 'border-good bg-good text-white' : 'border-line-strong'}`}>{item.complete ? '✓' : ''}</span>
                        <div class="min-w-0 flex-1">
                          <div class={`text-[14px] font-semibold ${item.complete ? 'text-muted line-through' : ''}`}>{item.title}</div>
                          <div class="truncate text-[12px] text-muted">{item.detail}</div>
                        </div>
                        <Show when={item.count}><span class="tnum rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold">{item.count}</span></Show>
                        <span class="text-faint">→</span>
                      </A>
                    </li>
                  )}
                </For>
              </ol>
            </div>
          </Page>
        );
      }}
    </Load>
  );
}
