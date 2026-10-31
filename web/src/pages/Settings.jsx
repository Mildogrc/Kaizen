import { For, Show, createSignal } from 'solid-js';
import { ai } from '../lib/ai';
import { del, put, useApi } from '../lib/api';
import { attempt, session, themeStore } from '../lib/store';
import { Icon } from '../components/icons';
import { Badge, Card, CopyButton, Field, Load, Page, Pills, Section } from '../components/ui';

const PROVIDERS = [
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'ChatGPT / OpenAI' },
  { value: 'gemini', label: 'Gemini' },
];
const MODELS = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openai: [],
  gemini: ['gemini-pro-latest', 'gemini-flash-latest'],
};
const SUBSCRIPTION_HELP = {
  openai: 'Uses your ChatGPT plan through “Sign in with ChatGPT” (or the official Codex CLI signed in with ChatGPT on this machine).',
};
const CLI_FOR = { openai: 'codex' };

function ApiKey(props) {
  const [key, setKey] = createSignal('');
  const save = async () => {
    if (await attempt(() => put('/settings/ai/key', { provider: props.provider, key: key() }), 'Key saved (encrypted)')) setKey('');
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      <input class="input max-w-sm flex-1 font-mono" type="password" autocomplete="off" value={key()} onInput={(e) => setKey(e.currentTarget.value)}
        placeholder={props.status.saved ? '•••••••• saved — paste to replace' : `${props.label} API key`} />
      <button class="btn btn-primary" disabled={!key().trim()} onClick={save}>Save key</button>
      <Show when={props.status.saved}><button class="btn btn-ghost" onClick={() => attempt(() => del(`/settings/ai/key/${props.provider}`), 'Key removed')}>Remove</button></Show>
      <Show when={props.status.instance}><Badge tone="info">server key available</Badge></Show>
    </div>
  );
}

function AiSettings(props) {
  const s = () => props.s;
  const [model, setModel] = createSignal(s().config.model);
  const models = useApi(() => (s().config.provider === 'openai' && s().chatgpt ? '/settings/ai/models' : null));
  const save = (patch) => attempt(() => put('/settings/ai', { ...s().config, ...patch }));
  const cli = () => s().clis[CLI_FOR[s().config.provider]];
  const subscribable = (provider) => (s().subscriptionProviders ?? ['openai']).includes(provider);
  const providerLabel = () => (s().config.provider === 'gemini' ? 'Gemini' : 'Claude');
  const modelOptions = () => [
    { value: '', label: 'Default' },
    ...(s().config.provider === 'openai' ? (models.data()?.models ?? []).map((m) => ({ value: m.id, label: m.name })) : MODELS[s().config.provider].map((m) => ({ value: m, label: m }))),
  ];
  return (
    <>
      <Card class="mb-4 flex flex-wrap items-center gap-3">
        <div class={`ai-orb !h-7 !w-7 ${s().route ? 'idle' : ''}`} />
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold">
            <Show when={s().route} fallback={<span class="text-warn">Not connected</span>}>Every “Ask AI” goes to: {s().route.label}</Show>
          </div>
          <Show when={s().routeError}><div class="text-[12px] text-warn">{s().routeError}</div></Show>
        </div>
        <button class="btn" disabled={!s().route} onClick={() => ai.ask({ kind: 'general', title: 'Connection test', prompt: 'Reply with one short, friendly sentence confirming you can hear me, then name the model you are.' })}>
          <Icon name="sparkle" size={14} /> Test
        </button>
      </Card>
      <div class="grid gap-4 lg:grid-cols-2">
        <Card class="space-y-4">
          <Field label="Provider">
            <Pills value={s().config.provider} options={PROVIDERS}
              onChange={(provider) => { setModel(''); save({ provider, model: '', mode: subscribable(provider) ? s().config.mode : 'api' }); }} />
          </Field>
          <Field label="Pay with">
            <Pills value={s().config.mode} onChange={(mode) => save({ mode })} options={[
              subscribable(s().config.provider)
                ? { value: 'subscription', label: 'My subscription' }
                : { value: 'subscription', label: 'My subscription · not available', disabled: true, title: `${providerLabel()} plans can’t be connected to Kaizen` },
              { value: 'api', label: 'API key' },
            ]} />
            <Show when={!subscribable(s().config.provider)}>
              <p class="mt-1.5 text-[11.5px] text-faint">{providerLabel()} Pro/Max-style plans can’t be connected to Kaizen. Use an API key, or switch to ChatGPT to use your plan.</p>
            </Show>
          </Field>
          <Field label="Model">
            <Pills value={s().config.model} onChange={(m) => { setModel(m); save({ model: m }); }} options={modelOptions()} />
            <div class="mt-2 flex gap-2">
              <input class="input font-mono" value={model()} onInput={(e) => setModel(e.currentTarget.value)} placeholder="custom model id" />
              <button class="btn" disabled={model() === s().config.model} onClick={() => save({ model: model().trim() })}>Use</button>
            </div>
          </Field>
        </Card>
        <Card class="space-y-3">
          <Show when={s().config.mode === 'subscription'} fallback={
            <>
              <div class="text-[13px] font-semibold">{PROVIDERS.find((p) => p.value === s().config.provider).label} API key</div>
              <p class="text-[12.5px] text-muted">Stored encrypted (AES-256-GCM) and only used for your requests.</p>
              <ApiKey provider={s().config.provider} label={PROVIDERS.find((p) => p.value === s().config.provider).label} status={s().apiKeys[s().config.provider]} />
            </>
          }>
            <div class="text-[13px] font-semibold">Using your subscription</div>
            <p class="text-[12.5px] text-muted">{SUBSCRIPTION_HELP[s().config.provider]}</p>
            <Show when={s().config.provider === 'openai'}>
              <Show when={s().chatgpt} fallback={
                <Show when={s().chatgptSignIn} fallback={<p class="text-[12px] text-warn">Sign in with ChatGPT isn’t available on this deployment (set AUTH_OPENAI_CLIENT_ID).</p>}>
                  <a class="btn btn-primary" rel="external" href="/auth/openai/start?purpose=connect&returnTo=%2Fsettings">Connect my ChatGPT plan</a>
                </Show>
              }>
                <div class="flex flex-wrap items-center gap-2 rounded-lg bg-good-soft px-3 py-2 text-[12.5px] text-good">
                  <Icon name="check" size={14} /> ChatGPT plan connected{s().chatgpt.email ? ` (${s().chatgpt.email})` : ''}{s().chatgpt.planType ? ` · ${s().chatgpt.planType}` : ''}
                  <button class="btn btn-sm ml-auto" onClick={() => attempt(() => del('/settings/ai/chatgpt'), 'ChatGPT disconnected')}>Disconnect</button>
                </div>
              </Show>
            </Show>
            <Show when={s().isOwner && cli()}>
              <div class="rounded-lg border border-line p-3 text-[12.5px]">
                <div class="flex items-center gap-2 font-medium">
                  <span class={`h-2 w-2 rounded-full ${cli().installed ? 'bg-good' : 'bg-faint'}`} />
                  {CLI_FOR[s().config.provider]} CLI {cli().installed ? 'installed' : 'not found'}
                </div>
                <Show when={cli().path}><div class="mt-0.5 truncate font-mono text-[11px] text-faint">{cli().path}</div></Show>
                <div class="mt-2 space-y-1.5">
                  <Show when={!cli().installed}>
                    <div class="flex items-center gap-2"><code class="flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px]">{cli().installCommand}</code><CopyButton small text={cli().installCommand} /></div>
                  </Show>
                  <div class="flex items-center gap-2"><code class="flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px]">{cli().loginCommand}</code><CopyButton small text={cli().loginCommand} /></div>
                  <p class="text-[11.5px] text-faint">Run the sign-in command once in a terminal on this machine.</p>
                </div>
              </div>
            </Show>
          </Show>
        </Card>
      </div>
    </>
  );
}

function Account(props) {
  const me = () => session.me();
  const [name, setName] = createSignal(me().user.name);
  const [tz, setTz] = createSignal(me().user.timezone);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = async () => { if (await attempt(() => put('/me', { name: name(), timezone: tz() }), 'Profile saved')) session.refresh(); };
  return (
    <Card class="space-y-4">
      <div class="grid gap-3 md:grid-cols-2">
        <Field label="Name"><input class="input" value={name()} onInput={(e) => setName(e.currentTarget.value)} /></Field>
        <Field label="Email"><input class="input" value={me().user.email} disabled /></Field>
        <Field label="Time zone" hint="Days, streaks, and due dates follow this zone.">
          <div class="flex gap-2">
            <input class="input" value={tz()} onInput={(e) => setTz(e.currentTarget.value)} />
            <Show when={browserTz && browserTz !== tz()}><button class="btn" onClick={() => setTz(browserTz)}>Use {browserTz}</button></Show>
          </div>
        </Field>
        <Field label="Theme">
          <Pills value={themeStore.theme()} onChange={themeStore.setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Field>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button class="btn btn-primary" onClick={save}>Save profile</button>
        <span class="text-[12px] text-muted">Signed in with: <For each={me().linkedProviders} fallback={<span>local sign-in</span>}>{(p) => <Badge class="ml-1">{p === 'openai' ? 'ChatGPT' : p}</Badge>}</For></span>
      </div>
    </Card>
  );
}

export default function Settings() {
  const q = useApi(() => '/settings/ai');
  return (
    <Page title="Settings" glyph="⚙" subtitle="Your account and how Kaizen talks to AI">
      <Section title="Account"><Account /></Section>
      <Section title="AI">
        <Load q={q}>{(s) => <AiSettings s={s} />}</Load>
      </Section>
      <p class="text-[11.5px] text-faint">Your data stays in your Kaizen database. AI requests go only to the provider you choose above.</p>
    </Page>
  );
}
