import { A, useParams } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { useApi } from '../lib/api';
import { num, titleCase } from '../lib/format';
import { Icon } from '../components/icons';
import { Badge, Card, CopyButton, Disclosure, Load, Page, Section, Table } from '../components/ui';

export default function SchemaDetail() {
  const params = useParams();
  const q = useApi(() => `/schemas/${params.slug}`);
  return (
    <Load q={q}>
      {(d) => (
        <Page title={d.schema.name} back={{ href: '/schemas', label: 'Schemas' }} subtitle={d.schema.description}
          actions={<>
            <CopyButton text={() => JSON.stringify(d.export, null, 2)} label="Copy schema JSON" />
            <a class="btn" rel="external" href={`/api/schemas/${d.schema.slug}/prompt`}><Icon name="download" size={14} /> LLM prompt</a>
            <A href={`/import?schema=${d.schema.slug}`} class="btn btn-primary">Import against this</A>
          </>}>
          <div class="mb-5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Badge tone="info">v{d.schema.version}</Badge>
            <span class="font-mono">{d.schema.itemType}</span>
            <span>· {titleCase(d.schema.category)}</span>
            <Show when={d.schema.courseName}><span>· {d.schema.courseName}</span></Show>
            <span>· {num(d.schema.itemCount)} items stored</span>
          </div>
          <Section title={`Fields (${d.schema.fields.length})`}>
            <Table rows={d.schema.fields} columns={[
              { label: 'Name', render: (f) => <span class="font-mono">{f.name}</span> },
              { label: 'Label', key: 'label' },
              { label: 'Type', render: (f) => <Badge>{f.fieldType.toLowerCase()}</Badge> },
              { label: 'Required', render: (f) => (f.required ? <span class="text-good">required</span> : <span class="text-faint">optional</span>) },
              { label: 'Notes', render: (f) => <span class="text-muted">{f.description ?? (f.enumOptions ? f.enumOptions.join(', ') : '')}</span> },
            ]} />
          </Section>
          <Show when={d.schema.config.flashcardRules?.length}>
            <Section title="Flashcard rules">
              <div class="grid gap-2 md:grid-cols-2">
                <For each={d.schema.config.flashcardRules}>
                  {(r) => <Card class="p-3"><div class="text-[13px] font-semibold">{r.name}</div><div class="mt-1 font-mono text-[11.5px] text-muted">front: {r.front}<br />back: {r.back}</div></Card>}
                </For>
              </div>
            </Section>
          </Show>
          <Disclosure title="LLM import prompt (what the AI receives)">
            <div class="mb-2"><CopyButton small text={() => d.prompt} label="Copy prompt" /></div>
            <pre class="max-h-[480px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-5 text-muted">{d.prompt}</pre>
          </Disclosure>
        </Page>
      )}
    </Load>
  );
}
