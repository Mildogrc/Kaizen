import { For, Show, createResource } from 'solid-js';

const LOGOS = {
  google: (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.2-8.5 2.2-6.3 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  ),
  openai: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M22.3 9.8a5.9 5.9 0 0 0-.5-4.9 6 6 0 0 0-6.5-2.9A6 6 0 0 0 4.9 4.2a5.9 5.9 0 0 0-4 2.9 6 6 0 0 0 .8 7 5.9 5.9 0 0 0 .5 4.9 6 6 0 0 0 6.5 2.9 5.9 5.9 0 0 0 4.4 2 6 6 0 0 0 5.7-4.2 5.9 5.9 0 0 0 4-2.9 6 6 0 0 0-.5-7zM13.1 22.4a4.4 4.4 0 0 1-2.8-1l.1-.1 4.7-2.7a.8.8 0 0 0 .4-.7v-6.6l2 1.1v5.5a4.4 4.4 0 0 1-4.4 4.5zM3.6 18.3a4.4 4.4 0 0 1-.5-3l.1.1 4.7 2.7a.8.8 0 0 0 .8 0l5.7-3.3v2.3L9.7 19.8a4.4 4.4 0 0 1-6.1-1.5zM2.3 8.2a4.4 4.4 0 0 1 2.3-1.9v5.6a.8.8 0 0 0 .4.7l5.7 3.3-2 1.1-4.7-2.7a4.4 4.4 0 0 1-1.7-6.1zm16.3 3.8L12.9 8.7l2-1.1 4.7 2.7a4.4 4.4 0 0 1-.7 8v-5.6a.8.8 0 0 0-.3-.7zm2-3-.1-.1-4.7-2.7a.8.8 0 0 0-.8 0L9.3 9.5V7.2L14 4.5a4.4 4.4 0 0 1 6.6 4.5zM8.3 12.9l-2-1.1V6.3a4.4 4.4 0 0 1 7.3-3.4l-.1.1-4.8 2.7a.8.8 0 0 0-.4.7zm1.1-2.3L12 9.1l2.6 1.5v3L12 15l-2.6-1.5z" />
    </svg>
  ),
};

export default function Login() {
  const [providers] = createResource(() => fetch('/auth/providers').then((r) => r.json()));
  const error = new URLSearchParams(location.search).get('error');
  const returnTo = encodeURIComponent(location.pathname === '/login' ? '/' : location.pathname + location.search);
  const available = () => (providers()?.providers ?? []).filter((p) => p.available);
  const unavailable = () => (providers()?.providers ?? []).filter((p) => !p.available);

  return (
    <div class="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div class="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--accent), transparent)' }} />
      <div class="card fade-up relative w-full max-w-[400px] p-7">
        <div class="mb-6 flex items-center gap-3">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-white">K</span>
          <div>
            <h1 class="text-[15px] font-semibold leading-tight">Sign in to Kaizen</h1>
            <p class="text-[12px] text-muted">Long-term learning, one day at a time.</p>
          </div>
        </div>
        <Show when={error}>
          <div class="mb-4 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>
        </Show>
        <div class="space-y-3">
          <For each={available()}>
            {(p) => (
              <Show when={p.id === 'openai'} fallback={
                <a rel="external" href={`/auth/${p.id}/start?returnTo=${returnTo}`} class="btn h-11 w-full justify-start gap-3 text-[13px]">
                  {LOGOS[p.id]}
                  <span class="flex-1 text-left">Continue with {p.name}</span>
                </a>
              }>
                <div class="rounded-xl border border-accent/40 bg-accent-soft/50 p-2.5">
                  <a rel="external" href={`/auth/openai/start?returnTo=${returnTo}`} class="btn btn-primary h-11 w-full justify-start gap-3 text-[13px]">
                    {LOGOS.openai}
                    <span class="flex-1 text-left">Continue with ChatGPT</span>
                    <span class="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">Recommended</span>
                  </a>
                  <p class="mt-2 px-1 text-[12px] leading-relaxed text-muted">
                    Also connects your ChatGPT plan, so the built-in AI tutor (grammar lessons, mnemonics, study plans) works right away with no API key.
                  </p>
                </div>
              </Show>
            )}
          </For>
          <Show when={providers() && !available().length}>
            <p class="text-[13px] text-bad">No sign-in method is configured on this server.</p>
          </Show>
          <For each={unavailable()}>
            {(p) => (
              <div class="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
                <span class="font-medium text-muted">{p.id === 'openai' ? 'ChatGPT' : p.name}</span> sign-in isn’t set up — {p.reason}
              </div>
            )}
          </For>
        </div>
        <Show when={providers()?.claude}>
          <p class="mt-5 text-[12px] leading-relaxed text-muted">
            <span class="font-medium text-muted">Using Claude?</span> {providers().claude.reason}
          </p>
        </Show>
      </div>
    </div>
  );
}
