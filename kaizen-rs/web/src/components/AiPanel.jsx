import { A } from '@solidjs/router';
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { ai } from '../lib/ai';
import { useApi } from '../lib/api';
import { relative } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { Icon } from './icons';
import { CopyButton, cx } from './ui';

const STATUS_TEXT = {
  connecting: 'Connecting',
  thinking: 'Thinking',
  writing: 'Writing',
  retrying: 'Retrying',
};

function Elapsed(props) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 250);
  onCleanup(() => clearInterval(timer));
  return <span class="tnum">{((now() - props.since) / 1000).toFixed(1)}s</span>;
}

/** Shown while the model works and nothing has streamed yet. */
function Thinking(props) {
  return (
    <div class="fade-up rounded-xl border border-line bg-surface-2/60 p-4" aria-live="polite">
      <div class="flex items-center gap-3">
        <div class="ai-orb" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-[13px] font-medium">
            <span class="shimmer-text">{STATUS_TEXT[props.pending.status] ?? 'Working'}</span>
            <span class="ai-dots text-muted"><span /><span /><span /></span>
          </div>
          <div class="mt-0.5 truncate text-[11px] text-muted">
            <Show when={props.pending.label} fallback="Routing your request…">{props.pending.label}</Show>
            {' · '}
            <Elapsed since={props.pending.startedAt} />
          </div>
        </div>
      </div>
      <div class="mt-4 space-y-2">
        <div class="skeleton h-3 w-[92%]" />
        <div class="skeleton h-3 w-[78%]" />
        <div class="skeleton h-3 w-[85%]" />
      </div>
    </div>
  );
}

function UserMessage(props) {
  const long = () => props.message.content.length > 600;
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div class="flex justify-end">
      <div class="max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2.5 text-[13px]">
        <div class={cx('whitespace-pre-wrap break-words', long() && !expanded() && 'line-clamp-6')}>{props.message.content}</div>
        <Show when={long()}>
          <button class="mt-1 text-[11px] font-medium text-accent-text hover:underline" onClick={() => setExpanded(!expanded())}>
            {expanded() ? 'Collapse' : `Show full prompt (${Math.round(props.message.content.length / 100) / 10}k chars)`}
          </button>
        </Show>
      </div>
    </div>
  );
}

function AssistantMessage(props) {
  const html = createMemo(() => renderMarkdown(props.content));
  return (
    <div class="group">
      <div class={cx('prose-ai', props.streaming && 'stream-caret')} innerHTML={html()} />
      <Show when={!props.streaming}>
        <div class="mt-1.5 flex items-center gap-2 text-[11px] text-faint opacity-70 transition-opacity group-hover:opacity-100">
          <Show when={props.message?.error}><span class="text-bad">{props.message.error}</span></Show>
          <Show when={props.message?.durationMs}><span>{(props.message.durationMs / 1000).toFixed(1)}s</span></Show>
          <Show when={props.message?.label}><span>· {props.message.label}</span></Show>
          <CopyButton text={props.content} small class="btn-ghost ml-auto" label="Copy" />
        </div>
      </Show>
    </div>
  );
}

function History(props) {
  const q = useApi(() => '/ai/conversations');
  return (
    <div class="absolute inset-x-3 top-14 z-10 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-lg)]">
      <Show when={q.data()?.conversations?.length} fallback={<div class="p-4 text-center text-[12px] text-muted">No conversations yet.</div>}>
        <For each={q.data().conversations}>
          {(c) => (
            <button class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-surface-2"
              onClick={() => { ai.openConversation(c.id); props.onClose(); }}>
              <span class="truncate">{c.title}</span>
              <span class="shrink-0 text-[11px] text-faint">{relative(c.updatedAt)}</span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}

export function AiPanel() {
  const s = ai.state;
  const [draft, setDraft] = createSignal('');
  const [showHistory, setShowHistory] = createSignal(false);
  const conn = () => s.connection;
  const locked = () => !conn().ok;
  let scroller;
  let input;
  let stick = true;

  const onScroll = () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  };
  createEffect(on(() => [s.messages.length, s.pending?.text, s.pending?.status], () => {
    if (stick && scroller) queueMicrotask(() => { scroller.scrollTop = scroller.scrollHeight; });
  }));
  createEffect(on(() => s.open, (open) => { if (open) { stick = true; setTimeout(() => input?.focus(), 50); } }));

  const submit = () => {
    const text = draft();
    if (!text.trim() || s.pending || locked()) return;
    setDraft('');
    stick = true;
    ai.send(text);
    if (input) input.style.height = '';
  };
  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(200, el.scrollHeight)}px`; };
  const actions = createMemo(() => (s.extras && ai.actionsFor ? ai.actionsFor(s.extras) : []));

  return (
    <Show when={s.open}>
      <aside class="slide-in fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)] sm:w-[460px]" aria-label="AI assistant">
        <header class="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <div class={cx('ai-orb !h-6 !w-6', !s.pending && 'idle')} />
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-semibold">{s.context.title}</div>
            <div class="truncate text-[11px] text-muted">
              <Show when={conn().ok} fallback={<span class="text-warn">{conn().checked ? 'Not connected' : 'Checking AI connection…'}</span>}>
                {conn().label}
              </Show>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" title="History" onClick={() => setShowHistory(!showHistory())}><Icon name="history" size={15} /></button>
          <button class="btn btn-ghost btn-sm" title="New chat" onClick={() => { ai.newChat(); setShowHistory(false); }}><Icon name="plus" size={15} /></button>
          <button class="btn btn-ghost btn-sm" title="Close (Esc)" onClick={() => ai.close()}><Icon name="close" size={15} /></button>
        </header>
        <Show when={showHistory()}><History onClose={() => setShowHistory(false)} /></Show>

        <div ref={scroller} onScroll={onScroll} class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <Show when={conn().checked && locked()}>
            <div class="fade-up rounded-xl border border-warn/40 bg-warn-soft p-4 text-[13px]">
              <div class="font-semibold text-text">Connect your AI first</div>
              <p class="mt-1 text-muted">{conn().error || 'Ask AI only works once your AI subscription is connected.'}</p>
              <p class="mt-1 text-muted">Sign in with ChatGPT to use your plan (recommended), or add an API key.</p>
              <A href="/settings" class="btn btn-primary btn-sm mt-3" onClick={() => ai.close()}>Open Settings → AI</A>
            </div>
          </Show>
          <Show when={!s.messages.length && !s.pending && !(conn().checked && locked())}>
            <div class="flex h-full flex-col items-center justify-center text-center">
              <div class="ai-orb idle mb-3 !h-10 !w-10" />
              <div class="text-[14px] font-semibold">Ask anything about your learning</div>
              <p class="mt-1 max-w-[300px] text-[12px] text-muted">Requests go through the AI subscription or key you chose in Settings → AI. Replies stream in as they’re written.</p>
            </div>
          </Show>
          <For each={s.messages}>
            {(m) => (m.role === 'user' ? <UserMessage message={m} /> : <AssistantMessage message={m} content={m.content} />)}
          </For>
          <Show when={s.pending}>
            {(p) => (
              <Show when={p().text} fallback={<Thinking pending={p()} />}>
                <div>
                  <div class="mb-1.5 flex items-center gap-2 text-[11px] text-muted">
                    <span class="ai-orb !h-3.5 !w-3.5" />
                    <span class="shimmer-text font-medium">Writing</span>
                    <span>·</span>
                    <Elapsed since={p().startedAt} />
                  </div>
                  <AssistantMessage content={p().text} streaming />
                </div>
              </Show>
            )}
          </Show>
          <Show when={s.error}>
            <div class="rounded-xl border border-bad/30 bg-bad-soft px-3.5 py-3 text-[12.5px] text-bad">
              <div class="font-medium">{s.error.message}</div>
              <Show when={s.error.code === 'not_connected'}>
                <A href="/settings" class="mt-1 inline-block font-medium underline" onClick={() => ai.close()}>Open Settings → AI</A>
              </Show>
            </div>
          </Show>
          <Show when={actions().length}>
            <div class="flex flex-wrap gap-2 rounded-xl border border-accent/30 bg-accent-soft p-3">
              <For each={actions()}>{(a) => <button class={cx('btn btn-sm', a.primary && 'btn-primary')} onClick={a.run}>{a.label}</button>}</For>
            </div>
          </Show>
        </div>

        <footer class="shrink-0 border-t border-line p-3">
          <div class={cx('flex items-end gap-2 rounded-xl border border-line bg-surface-2/50 p-1.5 focus-within:border-accent', locked() && 'cursor-not-allowed opacity-50')}>
            <textarea
              ref={input}
              rows="1"
              value={draft()}
              disabled={locked()}
              placeholder={locked() ? (conn().checked ? 'Connect an AI in Settings to start asking' : 'Checking your AI connection…') : s.messages.length ? 'Reply…' : 'Ask Kaizen…'}
              class="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] outline-none"
              onInput={(e) => { setDraft(e.currentTarget.value); grow(e.currentTarget); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') ai.close(); }}
            />
            <Show when={s.pending} fallback={
              <button class="btn btn-primary h-9 w-9 !p-0" disabled={locked() || !draft().trim()} onClick={submit} title="Send (Enter)"><Icon name="send" size={16} /></button>
            }>
              <button class="btn h-9 w-9 !p-0" onClick={() => ai.stop()} title="Stop"><Icon name="stop" size={14} /></button>
            </Show>
          </div>
          <div class="mt-1.5 px-1 text-[10.5px] text-faint">Enter to send · Shift+Enter for a new line</div>
        </footer>
      </aside>
    </Show>
  );
}
