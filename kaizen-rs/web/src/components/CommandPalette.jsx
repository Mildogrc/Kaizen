import { useNavigate } from '@solidjs/router';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ai } from '../lib/ai';
import { post } from '../lib/api';
import { EXTRA_PAGES, NAV } from '../lib/nav';
import { attempt, themeStore } from '../lib/store';
import { Icon } from './icons';
import { cx } from './ui';

export function CommandPalette(props) {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [index, setIndex] = createSignal(0);
  let input;

  const commands = createMemo(() => [
    ...NAV.flatMap((g) => g.items.map((i) => ({ ...i, kind: 'Go to', run: () => navigate(i.href) }))),
    ...EXTRA_PAGES.map((i) => ({ ...i, kind: 'Go to', run: () => navigate(i.href) })),
    { label: 'Ask the AI…', glyph: '✦', kind: 'Action', run: () => ai.newChat() },
    { label: 'Sync Anki now', glyph: '★', kind: 'Action', run: () => attempt(() => post('/anki/sync'), (r) => (r.ok ? `Synced ${r.cardsSynced} cards, ${r.reviewsAdded} new reviews` : r.error)) },
    { label: 'Theme: light', glyph: '☼', kind: 'Action', run: () => themeStore.setTheme('light') },
    { label: 'Theme: dark', glyph: '☾', kind: 'Action', run: () => themeStore.setTheme('dark') },
    { label: 'Theme: match system', glyph: '◐', kind: 'Action', run: () => themeStore.setTheme('system') },
  ]);
  const results = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return commands();
    return commands()
      .map((c) => ({ c, score: c.label.toLowerCase().indexOf(q) }))
      .filter((r) => r.score >= 0 || r.c.href?.includes(q))
      .sort((a, b) => (a.score < 0 ? 99 : a.score) - (b.score < 0 ? 99 : b.score))
      .map((r) => r.c);
  });
  const run = (c) => { props.onClose(); c?.run(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results().length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results()[index()]); }
    else if (e.key === 'Escape') props.onClose();
  };
  onMount(() => input?.focus());
  const outside = (e) => { if (e.key === 'Escape') props.onClose(); };
  document.addEventListener('keydown', outside);
  onCleanup(() => document.removeEventListener('keydown', outside));

  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="card fade-up w-full max-w-xl overflow-hidden p-0 shadow-[var(--shadow-lg)]" role="dialog" aria-label="Command palette">
          <div class="flex items-center gap-2 border-b border-line px-3">
            <Icon name="search" class="text-muted" />
            <input ref={input} value={query()} onInput={(e) => { setQuery(e.currentTarget.value); setIndex(0); }} onKeyDown={onKey}
              placeholder="Jump to a page or run an action…" class="h-12 flex-1 bg-transparent text-[14px] outline-none" />
            <span class="kbd">esc</span>
          </div>
          <div class="max-h-[50vh] overflow-y-auto p-1.5">
            <Show when={results().length} fallback={<div class="p-6 text-center text-[13px] text-muted">No matches</div>}>
              <For each={results()}>
                {(c, i) => (
                  <button class={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]', i() === index() ? 'bg-accent-soft text-accent-text' : 'hover:bg-surface-2')}
                    onMouseMove={() => setIndex(i())} onClick={() => run(c)}>
                    <span class="w-6 text-center text-[13px] opacity-80">{c.glyph}</span>
                    <span class="flex-1">{c.label}</span>
                    <span class="text-[11px] text-faint">{c.kind}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
