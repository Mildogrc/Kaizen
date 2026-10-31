// "Ask the AI": streams Server-Sent Events from POST /api/ai/chat and keeps
// one global conversation panel state (the drawer shows it anywhere).
import { createRoot } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { ApiError, invalidate } from './api';

/** Parse an SSE byte stream, calling onEvent(name, data) per event. */
async function readEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) {
        let parsed = data.join('\n');
        try { parsed = JSON.parse(parsed); } catch { /* plain text */ }
        onEvent(event, parsed);
      }
    }
  }
}

function createAi() {
  const [state, setState] = createStore({
    open: false,
    context: { kind: 'general', ref: null, title: 'Ask Kaizen' },
    conversationId: null,
    messages: [],
    pending: null, // { status, text, label, startedAt, firstTokenAt }
    error: null,
    extras: null,
    // Whether "Ask AI" can be used: { checked, ok, label, error }.
    connection: { checked: false, ok: false, label: '', error: '' },
  });
  let controller = null;
  let onExtras = null;
  // Context actions for structured results (e.g. "Save ratings").
  const api = { actionsFor: null };

  /**
   * Read one reply's events into the panel. Used both for a reply this tab
   * started and for re-attaching to one still running on the server.
   */
  async function follow(open, { initialText = '' } = {}) {
    const mine = new AbortController();
    controller = mine;
    let received = initialText;
    let frame = 0;
    const flush = () => { frame = 0; if (controller === mine) setState('pending', 'text', received); };
    const current = () => controller === mine;
    try {
      const res = await open(mine.signal);
      if (res === null) return; // nothing running
      await readEvents(res.body, (event, data) => {
        if (!current()) return;
        switch (event) {
          case 'conversation':
            setState('conversationId', data.conversationId);
            break;
          case 'snapshot':
            received = data.text ?? '';
            setState('pending', { status: data.status, label: data.label ?? '', text: received, startedAt: data.startedAt, firstTokenAt: received ? Date.now() : null });
            break;
          case 'start':
            setState('pending', (p) => ({ ...p, label: data.label, status: 'thinking' }));
            break;
          case 'status':
            setState('pending', 'status', data.status);
            break;
          case 'delta':
            received += data.text;
            if (!state.pending?.firstTokenAt) setState('pending', (p) => ({ ...p, firstTokenAt: Date.now(), status: 'writing' }));
            if (!frame) frame = requestAnimationFrame(flush);
            break;
          case 'done': {
            if (frame) cancelAnimationFrame(frame);
            const label = state.pending?.label;
            setState(produce((s) => {
              s.messages.push({ id: data.messageId, role: 'assistant', content: data.text, durationMs: data.durationMs, label });
              s.pending = null;
              s.extras = data.extras ?? null;
            }));
            if (data.extras && onExtras) onExtras(data.extras, data.text);
            break;
          }
          case 'error':
            if (frame) cancelAnimationFrame(frame);
            setState(produce((s) => {
              if (received.trim()) s.messages.push({ id: `partial-${Date.now()}`, role: 'assistant', content: received, error: data.message });
              s.pending = null;
              s.error = data.code === 'cancelled' ? null : { message: data.message, code: data.code };
            }));
            break;
          default:
            break;
        }
      });
      // The stream ended without a result (server restarted, network drop):
      // show whatever the server saved.
      if (current() && state.pending && state.conversationId) await reload(state.conversationId);
    } catch (err) {
      if (!current()) return; // detached on purpose; the server keeps going
      setState(produce((s) => {
        if (received.trim()) s.messages.push({ id: `partial-${Date.now()}`, role: 'assistant', content: received, error: 'Connection lost.' });
        s.pending = null;
        s.error = err.name === 'AbortError' ? null : { message: err.message, code: 'request' };
      }));
    } finally {
      if (current()) controller = null;
      invalidate('/ai/');
    }
  }

  /** Ask the server whether the chosen AI is actually connected. */
  async function checkConnection() {
    try {
      const res = await fetch('/api/settings/ai', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setState('connection', { checked: true, ok: !!data.route, label: data.route?.label ?? '', error: data.routeError ?? '' });
      return !!data.route;
    } catch {
      setState('connection', { checked: true, ok: false, label: '', error: 'Couldn’t check your AI connection.' });
      return false;
    }
  }

  /** Stop listening without cancelling the reply on the server. */
  function detach() {
    const c = controller;
    controller = null;
    c?.abort();
  }

  /** Cancel the reply (the partial answer is kept). */
  async function stop() {
    const id = state.conversationId;
    if (state.pending && id) {
      try { await fetch(`/api/ai/conversations/${id}/stop`, { method: 'POST', credentials: 'same-origin' }); } catch { /* best effort */ }
    }
  }

  /** Load a saved conversation; re-attach if a reply is still running. */
  async function reload(id) {
    const res = await fetch(`/api/ai/conversations/${id}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    applyConversation(data);
    return data;
  }

  function applyConversation(data) {
    setState({ conversationId: data.id, messages: data.messages, pending: null, error: null, extras: data.extras ?? null });
    if (data.extras && onExtras) onExtras(data.extras);
    if (data.running) attach(data.id);
  }

  function attach(id) {
    setState('pending', { status: 'connecting', text: '', label: '', startedAt: Date.now(), firstTokenAt: null });
    follow(async (signal) => {
      const res = await fetch(`/api/ai/conversations/${id}/stream`, { credentials: 'same-origin', signal, headers: { Accept: 'text/event-stream' } });
      if (res.status === 204) {
        await reload(id); // finished in the meantime
        return null;
      }
      if (!res.ok) throw new ApiError(`Could not reconnect (${res.status})`, res.status);
      return res;
    });
  }

  async function send(message) {
    const text = message.trim();
    if (!text || state.pending) return;
    // Nothing is sent unless an AI is connected (the panel explains how).
    if (!(await checkConnection())) return;
    setState(produce((s) => {
      s.messages.push({ id: `local-${Date.now()}`, role: 'user', content: text });
      s.pending = { status: 'connecting', text: '', label: '', startedAt: Date.now(), firstTokenAt: null };
      s.error = null;
      s.extras = null;
    }));
    // Plain chats are named after their first message; tools pass a title.
    const title = state.context.kind === 'general' && state.context.title === 'Ask Kaizen' ? undefined : state.context.title;
    const body = { conversationId: state.conversationId, contextKind: state.context.kind, contextRef: state.context.ref, title, message: text };
    await follow(async (signal) => {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
      if (!res.ok) {
        let msg = `AI request failed (${res.status})`;
        try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        throw new ApiError(msg, res.status);
      }
      return res;
    });
  }

  const sameContext = (kind, ref) => state.context.kind === kind && (state.context.ref ?? null) === (ref ?? null);

  /**
   * Open the panel for a context. With `resume`, the latest conversation for
   * that context comes back (still streaming if the AI is working). With
   * `prompt` and `autoSend`, a new conversation starts with that prompt.
   */
  async function ask({ kind = 'general', ref = null, title = 'Ask Kaizen', prompt, autoSend = true, resume = false, extras, actions } = {}) {
    checkConnection();
    onExtras = extras ?? null;
    api.actionsFor = actions ?? null;
    // Reopening the same lesson: keep what is on screen (including a live reply).
    if (resume && sameContext(kind, ref) && (state.messages.length || state.pending)) {
      setState('open', true);
      if (state.extras && onExtras) onExtras(state.extras);
      return;
    }
    detach();
    setState({ open: true, context: { kind, ref, title }, conversationId: null, messages: [], pending: null, error: null, extras: null });
    if (resume) {
      try {
        const q = new URLSearchParams({ contextKind: kind, ...(ref ? { contextRef: ref } : {}) });
        const res = await fetch(`/api/ai/conversation?${q}`, { credentials: 'same-origin' });
        const data = await res.json();
        if (data.conversation) {
          applyConversation(data.conversation);
          return;
        }
      } catch { /* start fresh */ }
    }
    if (prompt && autoSend) send(prompt);
  }

  async function openConversation(id) {
    checkConnection();
    detach();
    onExtras = null;
    api.actionsFor = null;
    const res = await fetch(`/api/ai/conversations/${id}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    setState({ open: true, context: { kind: 'general', ref: null, title: data.title } });
    applyConversation(data);
  }

  const newChat = () => ask({ kind: 'general', title: 'Ask Kaizen', autoSend: false });
  const close = () => setState('open', false);
  const toggle = () => {
    if (!state.open) checkConnection();
    setState('open', (o) => !o);
  };

  return Object.assign(api, { state, send, stop, detach, ask, openConversation, newChat, close, toggle, checkConnection });
}

export const ai = createRoot(createAi);
