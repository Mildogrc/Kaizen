import { A } from '@solidjs/router';
import { For, Show, children as resolveChildren, createEffect, createSignal, onCleanup, onMount, splitProps, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { Icon } from './icons';

const cx = (...parts) => parts.filter(Boolean).join(' ');
export { cx };

export function Page(props) {
  return (
    <div class="fade-up mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <Show when={props.back}>
            <A href={props.back.href} class="mb-1 inline-flex items-center gap-1 text-[12px] text-muted hover:text-text">
              ← {props.back.label}
            </A>
          </Show>
          <h1 class="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <Show when={props.glyph}><span class="text-[20px] opacity-80">{props.glyph}</span></Show>
            {props.title}
          </h1>
          <Show when={props.subtitle}><p class="mt-0.5 max-w-3xl text-[13px] text-muted">{props.subtitle}</p></Show>
        </div>
        <Show when={props.actions}><div class="flex flex-wrap items-center gap-2">{props.actions}</div></Show>
      </header>
      {props.children}
    </div>
  );
}

export function Section(props) {
  return (
    <section class={cx('mb-7', props.class)}>
      <Show when={props.title || props.actions}>
        <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[13px] font-semibold uppercase tracking-wider text-muted">{props.title}</h2>
          <Show when={props.actions}><div class="flex flex-wrap items-center gap-2">{props.actions}</div></Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

export function Card(props) {
  const [local, rest] = splitProps(props, ['class', 'children', 'pad']);
  return (
    <div class={cx('card', local.pad === false ? '' : 'p-4', local.class)} {...rest}>
      {local.children}
    </div>
  );
}

const TONES = {
  neutral: 'bg-surface-2 text-muted border-line',
  accent: 'bg-accent-soft text-accent-text border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge(props) {
  return (
    <span class={cx('inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap', TONES[props.tone ?? 'neutral'], props.class)}>
      {props.children}
    </span>
  );
}

export const toneFor = (status) =>
  ({ ACTIVE: 'accent', COMPLETED: 'good', MASTERED: 'good', READING: 'accent', FINISHED: 'good', PAUSED: 'warn', ABANDONED: 'neutral', REVIEW: 'info', LEARNING: 'warn', NEW: 'neutral', PLANNED: 'neutral' })[status] ?? 'neutral';

export function Stat(props) {
  const body = () => (
    <>
      <div class="text-[11px] font-medium uppercase tracking-wider text-muted">{props.label}</div>
      <div class="tnum mt-1 truncate text-[22px] font-semibold leading-tight" style={props.color ? { color: props.color } : undefined}>
        {props.value}
      </div>
      <Show when={props.hint}><div class="mt-0.5 truncate text-[11px] text-faint" title={typeof props.hint === 'string' ? props.hint : undefined}>{props.hint}</div></Show>
    </>
  );
  return (
    <Show when={props.href} fallback={<div class="card min-w-0 p-3.5">{body()}</div>}>
      <A href={props.href} class="card block min-w-0 p-3.5 transition-colors hover:border-line-strong">{body()}</A>
    </Show>
  );
}

export function StatGrid(props) {
  return <div class={cx('mb-6 grid grid-cols-2 gap-3', props.cols ?? 'md:grid-cols-4', props.class)}>{props.children}</div>;
}

export function Progress(props) {
  const value = () => Math.max(0, Math.min(100, props.value ?? 0));
  return (
    <div class={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', props.class)} role="progressbar" aria-valuenow={Math.round(value())} aria-valuemin="0" aria-valuemax="100">
      <div class="h-full rounded-full transition-[width] duration-500" style={{ width: `${value()}%`, background: props.color ?? 'var(--accent)' }} />
    </div>
  );
}

/** A row of pill buttons for choosing one option (preferred over dropdowns). */
export function Pills(props) {
  return (
    <div class={cx('flex flex-wrap gap-1.5', props.class)} role="group" aria-label={props.label}>
      <For each={props.options}>
        {(option) => {
          const value = typeof option === 'object' ? option.value : option;
          const label = typeof option === 'object' ? option.label : option;
          return (
            <button type="button" class={cx('pill', option.disabled && 'cursor-not-allowed opacity-45 line-through decoration-faint hover:!border-line hover:!text-muted')}
              aria-pressed={props.value === value} disabled={option.disabled} onClick={() => props.onChange(value)} title={option.title}>
              {label}
              <Show when={option.count != null}><span class="tnum text-faint">{option.count}</span></Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function Toggle(props) {
  return (
    <label class={cx('inline-flex cursor-pointer items-center gap-2 text-[13px]', props.class)}>
      <button
        type="button"
        role="switch"
        aria-checked={!!props.checked}
        onClick={() => props.onChange(!props.checked)}
        disabled={props.disabled}
        class={cx('relative h-5 w-9 rounded-full transition-colors', props.checked ? 'bg-accent' : 'bg-surface-3')}
      >
        <span class={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]', props.checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <Show when={props.label}><span>{props.label}</span></Show>
    </label>
  );
}

export function Empty(props) {
  return (
    <div class={cx('rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-[13px] text-muted', props.class)}>
      {props.children}
    </div>
  );
}

export function Spinner(props) {
  return <span class={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', props.class ?? 'h-4 w-4')} aria-label="Loading" />;
}

export function Skeleton(props) {
  return <div class={cx('skeleton', props.class)} style={props.style} />;
}

export function PageSkeleton() {
  return (
    <div class="mx-auto w-full max-w-[1280px] px-4 pt-6 sm:px-6 lg:px-8">
      <Skeleton class="mb-2 h-7 w-56" />
      <Skeleton class="mb-6 h-4 w-96 max-w-full" />
      <div class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <For each={[0, 1, 2, 3]}>{() => <Skeleton class="h-[86px]" />}</For>
      </div>
      <Skeleton class="mb-3 h-40" />
      <Skeleton class="h-64" />
    </div>
  );
}

export function ErrorBox(props) {
  return (
    <div class="mx-auto max-w-xl px-4 pt-16 text-center">
      <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bad-soft text-bad"><Icon name="warning" /></div>
      <h2 class="text-[15px] font-semibold">Couldn’t load this page</h2>
      <p class="mt-1 text-[13px] text-muted">{props.error?.message ?? String(props.error)}</p>
      <Show when={props.retry}><button class="btn mt-4" onClick={props.retry}>Try again</button></Show>
    </div>
  );
}

/**
 * Render `children(data)` for a useApi query, with skeleton and error states.
 * Refetches of the same endpoint are reconciled into a store (fine-grained
 * updates, local state kept); a different endpoint (new route params)
 * remounts the page with its own data.
 */
export function Load(props) {
  const [store, setStore] = createStore({ value: undefined, key: undefined });
  createEffect(() => {
    const key = props.q.key();
    const data = props.q.data();
    if (key !== store.key) {
      if (data !== undefined) setStore({ value: data, key });
      else if (store.key !== undefined) setStore({ value: undefined, key: undefined });
    } else if (data !== undefined) {
      setStore('value', reconcile(data, { merge: true }));
    }
  });
  return (
    <Show when={store.key} keyed fallback={<Show when={props.q.error()} fallback={props.fallback ?? <PageSkeleton />}><ErrorBox error={props.q.error()} retry={() => props.q.refetch()} /></Show>}>
      {() => untrack(() => props.children(store.value))}
    </Show>
  );
}

/** Focus an element once it is in the document (autofocus does not fire inside portals). */
export const focusOnMount = (el) => queueMicrotask(() => el.isConnected && el.focus());

export function Field(props) {
  return (
    <label class={cx('block', props.class)}>
      <span class="label">{props.label}</span>
      {props.children}
      <Show when={props.hint}><span class="mt-1 block text-[11px] text-faint">{props.hint}</span></Show>
    </label>
  );
}

export function CopyButton(props) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof props.text === 'function' ? props.text() : props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <button type="button" class={cx('btn', props.primary && 'btn-primary', props.small && 'btn-sm', props.class)} onClick={copy}>
      <Icon name={copied() ? 'check' : 'copy'} size={14} />
      {copied() ? 'Copied' : props.label ?? 'Copy'}
    </button>
  );
}

export function Modal(props) {
  const onKey = (e) => { if (e.key === 'Escape') props.onClose?.(); };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-[2px]" onClick={(e) => e.target === e.currentTarget && props.onClose?.()}>
        <div class={cx('card fade-up w-full p-0 shadow-[var(--shadow-lg)]', props.width ?? 'max-w-lg')} role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 class="text-[14px] font-semibold">{props.title}</h3>
            <button class="btn btn-ghost btn-sm" onClick={() => props.onClose?.()} aria-label="Close"><Icon name="close" size={14} /></button>
          </div>
          <div class="p-4">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}

/** Collapsible panel (replaces <details>, keeps state per mount). */
export function Disclosure(props) {
  const [open, setOpen] = createSignal(!!props.open);
  return (
    <div class={cx('card overflow-hidden p-0', props.class)}>
      <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-medium hover:bg-surface-2" onClick={() => setOpen(!open())} aria-expanded={open()}>
        <span class="flex items-center gap-2">{props.title}</span>
        <Icon name={open() ? 'chevronDown' : 'chevronRight'} size={14} class="text-muted" />
      </button>
      <Show when={open()}><div class="border-t border-line p-4">{props.children}</div></Show>
    </div>
  );
}

export function Table(props) {
  return (
    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-[12.5px]">
        <thead class="border-b border-line text-[11px] uppercase tracking-wider text-muted">
          <tr><For each={props.columns}>{(c) => <th class={cx('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>{c.label}</th>}</For></tr>
        </thead>
        <tbody class="divide-y divide-line">
          <For each={props.rows}>
            {(row) => (
              <tr class="hover:bg-surface-2/60">
                <For each={props.columns}>{(c) => <td class={cx('px-3 py-2', c.align === 'right' && 'tnum text-right', c.class)}>{c.render ? c.render(row) : row[c.key]}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export function Kbd(props) {
  const c = resolveChildren(() => props.children);
  return <span class="kbd">{c()}</span>;
}
