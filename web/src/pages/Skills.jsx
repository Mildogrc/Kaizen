import { A } from '@solidjs/router';
import { For } from 'solid-js';
import { useApi } from '../lib/api';
import { num } from '../lib/format';
import { Load, Page, Stat, StatGrid } from '../components/ui';

const GLYPHS = { nato: 'Ⓝ', codeforces: '</>', reading: '»', youtube: '▶', math: '∑', books: '❦' };

export default function Skills() {
  const q = useApi(() => '/skills');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Skills" glyph="⌨" subtitle="Pick a focused skill to practice or analyze">
          <StatGrid cols="md:grid-cols-3">
            <Stat label="Skills" value={d.stats.skills} />
            <Stat label="Learning items" value={num(d.stats.learningItems)} />
            <Stat label="Reading sessions" value={num(d.stats.readingSessions)} />
          </StatGrid>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <For each={d.skills}>
              {(s) => (
                <A href={s.href} class="card group flex flex-col p-4 transition-colors hover:border-accent/50">
                  <div class="flex items-center gap-3">
                    <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-[15px] font-semibold text-accent-text">{GLYPHS[s.key] ?? '◆'}</span>
                    <div class="min-w-0">
                      <div class="text-[14px] font-semibold">{s.label}</div>
                      <div class="tnum text-[12px] text-muted">{num(s.count)} {s.unit}</div>
                    </div>
                    <span class="ml-auto text-faint transition-transform group-hover:translate-x-0.5">→</span>
                  </div>
                  <p class="mt-3 text-[12.5px] text-muted">{s.detail}</p>
                </A>
              )}
            </For>
          </div>
        </Page>
      )}
    </Load>
  );
}
