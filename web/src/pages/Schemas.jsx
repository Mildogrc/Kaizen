import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { useApi } from '../lib/api';
import { num, titleCase } from '../lib/format';
import { Badge, Load, Page, Section } from '../components/ui';

const ORDER = ['LANGUAGE', 'MATH', 'SKILL', 'BOOK', 'CERTIFICATION', 'CUSTOM'];

export default function Schemas() {
  const q = useApi(() => '/schemas');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Schemas" glyph="⬡" subtitle="Every content type is a schema — define one to add a new kind of learning material"
          actions={<A href="/schemas/new" class="btn btn-primary">+ New schema</A>}>
          <For each={ORDER}>
            {(cat) => (
              <Show when={d.schemas.some((s) => s.category === cat)}>
                <Section title={titleCase(cat)}>
                  <div class="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    <For each={d.schemas.filter((s) => s.category === cat)}>
                      {(s) => (
                        <A href={`/schemas/${s.slug}`} class="card block p-3.5 transition-colors hover:border-line-strong">
                          <div class="flex items-center justify-between gap-2"><span class="truncate text-[13.5px] font-semibold">{s.name}</span><Badge tone="info">v{s.version}</Badge></div>
                          <div class="mt-0.5 truncate font-mono text-[11px] text-faint">{s.itemType}</div>
                          <div class="tnum mt-2 flex gap-3 text-[11.5px] text-muted"><span>{s.fieldCount} fields</span><span>{num(s.itemCount)} items</span><Show when={s.courseName}><span class="ml-auto">{s.courseName}</span></Show></div>
                        </A>
                      )}
                    </For>
                  </div>
                </Section>
              </Show>
            )}
          </For>
        </Page>
      )}
    </Load>
  );
}
