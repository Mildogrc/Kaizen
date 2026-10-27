import { A, useSearchParams } from '@solidjs/router';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { ai } from '../lib/ai';
import { api, post, useApi } from '../lib/api';
import { num } from '../lib/format';
import { toast } from '../lib/store';
import { Icon } from '../components/icons';
import { Card, Empty, Field, Load, Page, Pills, Section } from '../components/ui';

function Preview(props) {
  return (
    <Card class="mt-4">
      <div class="flex flex-wrap items-center gap-4 text-[13px]">
        <span><b class="tnum">{props.result.total}</b> items</span>
        <span class="text-good"><b class="tnum">{props.result.validCount}</b> valid</span>
        <span class={props.result.errorCount ? 'text-bad' : 'text-muted'}><b class="tnum">{props.result.errorCount}</b> with errors</span>
        <Show when={props.result.savedCount}><span class="text-good">Saved {num(props.result.savedCount)} ✓</span></Show>
      </div>
      <Show when={props.result.errors.length}>
        <div class="mt-3 max-h-48 space-y-1 overflow-y-auto text-[12px]">
          <For each={props.result.errors}>{(e) => <div class="text-bad">Item {e.index + 1}: {e.errors.join('; ')}</div>}</For>
        </div>
      </Show>
      <Show when={props.result.validSample.length}>
        <div class="mt-3 text-[11.5px] font-medium uppercase tracking-wider text-muted">Sample</div>
        <pre class="mt-1 max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 text-[11.5px]">{JSON.stringify(props.result.validSample.slice(0, 3).map((v) => v.data), null, 2)}</pre>
      </Show>
    </Card>
  );
}

export default function Import() {
  const [params, setParams] = useSearchParams();
  const q = useApi(() => '/import');
  return (
    <Load q={q}>
      {(d) => {
        const course = () => params.course ?? d.schemas.find((s) => s.slug === params.schema)?.courseSlug ?? d.courses[0]?.slug;
        const schemas = createMemo(() => d.schemas.filter((s) => s.courseSlug === course()));
        const schema = () => (schemas().some((s) => s.slug === params.schema) ? params.schema : schemas()[0]?.slug);
        const [request, setRequest] = createSignal('');
        const [text, setText] = createSignal('');
        const [result, setResult] = createSignal(null);
        const [busy, setBusy] = createSignal(false);
        createEffect(() => { schema(); setResult(null); });

        const run = async (payload, commit) => {
          setBusy(true);
          try {
            const r = await post('/import', { schemaSlug: schema(), commit, ...payload }, { refresh: commit });
            setResult(r);
            if (commit && r.savedCount) toast(`Saved ${num(r.savedCount)} items`, 'good');
            return r;
          } catch (err) {
            toast(err.message, 'bad');
          } finally {
            setBusy(false);
          }
        };
        const generate = async () => {
          const detail = await api(`/schemas/${schema()}`);
          const ask = request().trim() || 'Generate 10 high-quality items appropriate for my current level.';
          ai.ask({
            kind: 'schema-import', ref: schema(), title: `Generate ${detail.schema.name} items`,
            prompt: `${detail.prompt}\n\n## What to generate\n${ask}\n\nReturn only the JSON array.`,
            actions: (extras) => (extras.json ? [
              { label: 'Validate', run: () => { run({ json: extras.json }, false); setText(JSON.stringify(extras.json, null, 2)); } },
              { label: `Import ${Array.isArray(extras.json) ? extras.json.length : 1} items`, primary: true, run: async () => { setText(JSON.stringify(extras.json, null, 2)); if ((await run({ json: extras.json }, true))?.savedCount) ai.close(); } },
            ] : []),
          });
        };
        return (
          <Page title="Import content" glyph="⇥" subtitle="Pick an area and content type, generate items with your AI (or paste JSON from anywhere), validate, save.">
            <Section title="1 · Area">
              <Pills value={course()} onChange={(c) => setParams({ course: c, schema: undefined })} options={d.courses.map((c) => ({ value: c.slug, label: c.name }))} />
            </Section>
            <Section title="2 · Content type">
              <Show when={schemas().length} fallback={<Empty>No content types for this area. <A href="/schemas/new" class="text-accent-text underline">Design one</A>.</Empty>}>
                <Pills value={schema()} onChange={(s) => setParams({ schema: s })} options={schemas().map((s) => ({ value: s.slug, label: s.name }))} />
                <p class="mt-2 text-[12px] text-muted">Schema details and the raw LLM prompt: <A href={`/schemas/${schema()}`} class="text-accent-text hover:underline">{schema()}</A></p>
              </Show>
            </Section>
            <Show when={schema()}>
              <div class="grid gap-4 xl:grid-cols-2">
                <Section title="3a · Generate with AI">
                  <Card class="space-y-3">
                    <Field label="What should the AI create?">
                      <textarea class="input min-h-28" value={request()} onInput={(e) => setRequest(e.currentTarget.value)} placeholder="e.g. 20 JLPT N4 verbs about travel, with example sentences" />
                    </Field>
                    <button class="btn btn-primary" onClick={generate}><Icon name="sparkle" size={14} /> Generate</button>
                    <p class="text-[11.5px] text-faint">The AI gets the full schema contract; its JSON comes back with Validate and Import buttons.</p>
                  </Card>
                </Section>
                <Section title="3b · Paste JSON">
                  <Card class="space-y-3">
                    <textarea class="input min-h-40 font-mono text-[11.5px]" value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder='[{"term": "…", "reading": "…"}]' />
                    <div class="flex gap-2">
                      <button class="btn" disabled={busy() || !text().trim()} onClick={() => run({ jsonText: text() }, false)}>Validate</button>
                      <button class="btn btn-primary" disabled={busy() || !text().trim()} onClick={() => run({ jsonText: text() }, true)}>Save valid items</button>
                    </div>
                  </Card>
                </Section>
              </div>
              <Show when={result()}><Preview result={result()} /></Show>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
