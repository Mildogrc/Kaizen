import { A, useLocation } from '@solidjs/router';
import { For, Show, Suspense, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { ai } from '../lib/ai';
import { prefetch, useApi } from '../lib/api';
import { num } from '../lib/format';
import { ankiRelay } from '../lib/anki-relay';
import { NAV, SETTINGS_NAV } from '../lib/nav';
import { session, themeStore, toastStore } from '../lib/store';
import { AiPanel } from './AiPanel';
import { CommandPalette } from './CommandPalette';
import { Icon } from './icons';
import { PageSkeleton, cx } from './ui';

function Toasts() {
  const tones = { good: 'border-good/30', bad: 'border-bad/40', info: 'border-line' };
  return (
    <div class="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      <For each={toastStore.toasts()}>
        {(t) => (
          <div class={cx('card fade-up pointer-events-auto flex items-start gap-2 px-3.5 py-2.5 text-[13px] shadow-[var(--shadow-lg)]', tones[t.tone])}>
            <span class={cx('mt-1 h-2 w-2 shrink-0 rounded-full', t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-accent')} />
            <span class="flex-1">{t.message}</span>
            <button class="text-muted hover:text-text" onClick={() => toastStore.dismiss(t.id)} aria-label="Dismiss"><Icon name="close" size={13} /></button>
          </div>
        )}
      </For>
    </div>
  );
}

function ThemeButton() {
  const next = { system: 'light', light: 'dark', dark: 'system' };
  const icon = { system: 'monitor', light: 'sun', dark: 'moon' };
  return (
    <button class="btn btn-ghost btn-sm" title={`Theme: ${themeStore.theme()}`} onClick={() => themeStore.setTheme(next[themeStore.theme()])}>
      <Icon name={icon[themeStore.theme()]} size={15} />
    </button>
  );
}

function NavLink(props) {
  const location = useLocation();
  const item = () => props.item;
  const active = () => {
    const path = location.pathname;
    const under = (href) => path === href || path.startsWith(`${href}/`);
    return item().end ? path === item().href : under(item().href) || (item().also ?? []).some(under);
  };
  return (
    <A href={item().href} end onClick={props.onNavigate} onMouseEnter={() => item().api && prefetch(item().api)} aria-current={active() ? 'page' : undefined}
      class={cx('flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors', active() ? 'bg-accent-soft font-medium text-accent-text' : 'text-muted hover:bg-surface-2 hover:text-text')}>
      <span class="w-5 text-center text-[13px]">{item().glyph}</span>
      {item().label}
      <Show when={props.count}><span class="tnum ml-auto text-[11px]">{num(props.count)}</span></Show>
    </A>
  );
}

function Sidebar(props) {
  const me = () => session.me()?.user;
  const today = useApi(() => '/today');
  const due = () => today.data()?.cardsDue;
  const signOut = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    session.setMe(null);
  };
  return (
    <nav class="flex h-full flex-col">
      <A href="/" class="flex h-14 shrink-0 items-center gap-2.5 px-4" onClick={props.onNavigate}>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-white">K</span>
        <span class="text-[15px] font-semibold tracking-tight">Kaizen</span>
      </A>
      <div class="flex-1 overflow-y-auto px-2.5 pb-3">
        <For each={NAV}>{(item) => <NavLink item={item} onNavigate={props.onNavigate} count={item.count ? due() : undefined} />}</For>
        <div class="h-6" />
        <NavLink item={SETTINGS_NAV} onNavigate={props.onNavigate} />
      </div>
      <div class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <Show when={me()?.avatarUrl} fallback={<span class="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold">{(me()?.name ?? '?').slice(0, 1)}</span>}>
          <img src={me().avatarUrl} alt="" class="h-7 w-7 rounded-full" referrerpolicy="no-referrer" />
        </Show>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13px] font-medium">{me()?.name}</div>
          <div class="truncate text-[11px] text-muted">{me()?.timezone}</div>
        </div>
        <ThemeButton />
        <button class="btn btn-ghost btn-sm" title="Sign out" onClick={signOut}><Icon name="logout" size={15} /></button>
      </div>
    </nav>
  );
}

export function Layout(props) {
  const location = useLocation();
  const [menu, setMenu] = createSignal(false);
  const [palette, setPalette] = createSignal(false);

  const onKey = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(!palette()); }
    else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); ai.toggle(); }
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  createEffect(() => { location.pathname; setMenu(false); });

  // Cloud installs reach the learner's Anki through this tab.
  createEffect(() => {
    const anki = session.me()?.anki;
    if (anki?.mode === 'relay') ankiRelay.start(anki.connectUrl);
  });
  onCleanup(() => ankiRelay.stop());

  return (
    <div class="flex min-h-dvh">
      <aside class="sticky top-0 hidden h-dvh w-[232px] shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      <Show when={menu()}>
        <div class="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMenu(false)} />
        <aside class="slide-in fixed inset-y-0 left-0 z-50 w-[260px] border-r border-line bg-surface lg:hidden"><Sidebar onNavigate={() => setMenu(false)} /></aside>
      </Show>
      <div class="flex min-w-0 flex-1 flex-col">
        <header class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur sm:px-4">
          <button class="btn btn-ghost btn-sm lg:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Icon name="menu" /></button>
          <button class="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-[13px] text-muted hover:border-line-strong" onClick={() => setPalette(true)}>
            <Icon name="search" size={14} />
            <span class="flex-1">Search or jump to…</span>
            <span class="kbd hidden sm:inline-flex">⌘K</span>
          </button>
          <div class="flex-1" />
          <Show when={ankiRelay.status() !== 'off'}>
            <span class={cx('hidden items-center gap-1.5 text-[11px] sm:flex', ankiRelay.status() === 'ready' ? 'text-good' : 'text-warn')} title="Anki relay through this browser tab">
              <span class={cx('h-1.5 w-1.5 rounded-full', ankiRelay.status() === 'ready' ? 'bg-good' : 'bg-warn')} />Anki {ankiRelay.status()}
            </span>
          </Show>
          <button class="btn btn-primary btn-sm gap-1.5" onClick={() => ai.toggle()} title="Ask the AI (⌘J)">
            <Icon name="sparkle" size={14} /> Ask AI
          </button>
        </header>
        <main class="min-w-0 flex-1">
          <Suspense fallback={<PageSkeleton />}>{props.children}</Suspense>
        </main>
      </div>
      <AiPanel />
      <Show when={palette()}><CommandPalette onClose={() => setPalette(false)} /></Show>
      <Toasts />
    </div>
  );
}

