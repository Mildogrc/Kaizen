import { A, useNavigate } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { num, titleCase } from '../lib/format';
import { attempt } from '../lib/store';
import { Badge, Card, Disclosure, Empty, Field, Load, Page, Pills, Stat, StatGrid, toneFor } from '../components/ui';

export const BOOK_STATUSES = ['WANT_TO_READ', 'READING', 'FINISHED', 'PAUSED', 'ABANDONED'];

function NewBook() {
  const navigate = useNavigate();
  const [form, setForm] = createSignal({ title: '', author: '', category: '', pageCount: '', status: 'WANT_TO_READ' });
  const set = (k) => (e) => setForm({ ...form(), [k]: e.currentTarget.value });
  const create = async (e) => {
    e.preventDefault();
    const f = form();
    const r = await attempt(() => post('/books', { ...f, pageCount: f.pageCount ? Number(f.pageCount) : null }));
    if (r?.id) navigate(`/books/${r.id}`);
  };
  return (
    <form onSubmit={create} class="grid gap-3 md:grid-cols-2">
      <Field label="Title"><input class="input" required value={form().title} onInput={set('title')} /></Field>
      <Field label="Author"><input class="input" value={form().author} onInput={set('author')} /></Field>
      <Field label="Category"><input class="input" value={form().category} onInput={set('category')} placeholder="e.g. Geopolitics" /></Field>
      <Field label="Pages"><input class="input" type="number" min="1" value={form().pageCount} onInput={set('pageCount')} /></Field>
      <Field label="Status" class="md:col-span-2">
        <Pills value={form().status} onChange={(status) => setForm({ ...form(), status })} options={BOOK_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
      </Field>
      <div class="md:col-span-2"><button class="btn btn-primary">Add book</button></div>
    </form>
  );
}

export default function Books() {
  const q = useApi(() => '/books');
  const [filter, setFilter] = createSignal('all');
  return (
    <Load q={q}>
      {(d) => {
        const shown = () => d.books.filter((b) => filter() === 'all' || b.status === filter());
        return (
          <Page title="Books" glyph="❦" subtitle="Reading log, notes worth remembering, and pace">
            <StatGrid>
              <Stat label="Books" value={d.stats.books} />
              <Stat label="Reading" value={d.stats.reading} />
              <Stat label="Finished" value={d.stats.finished} />
              <Stat label="Marked to remember" value={d.stats.remember} />
            </StatGrid>
            <div class="mb-5"><Disclosure title="Add a book"><NewBook /></Disclosure></div>
            <Pills class="mb-4" value={filter()} onChange={setFilter}
              options={[{ value: 'all', label: 'All', count: d.books.length }, ...BOOK_STATUSES.map((s) => ({ value: s, label: titleCase(s), count: d.books.filter((b) => b.status === s).length }))]} />
            <Show when={shown().length} fallback={<Empty>No books here yet.</Empty>}>
              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <For each={shown()}>
                  {(b) => (
                    <A href={`/books/${b.id}`} class="card flex gap-3 p-4 transition-colors hover:border-line-strong">
                      <span class="flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-surface-3 text-[18px]">❦</span>
                      <div class="min-w-0 flex-1">
                        <div class="line-clamp-2 text-[14px] font-semibold">{b.title}</div>
                        <div class="truncate text-[12px] text-muted">{b.author ?? 'Unknown author'}</div>
                        <div class="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge tone={toneFor(b.status)}>{titleCase(b.status)}</Badge>
                          <Show when={b.category}><Badge>{b.category}</Badge></Show>
                          <Show when={b.rating}><span class="text-[12px] text-warn">{'★'.repeat(b.rating)}</span></Show>
                        </div>
                        <div class="tnum mt-1.5 text-[11.5px] text-faint">{b.pageCount ? `${num(b.pageCount)} pages · ` : ''}{b.notes} notes{b.remember ? ` · ${b.remember} to remember` : ''}</div>
                      </div>
                    </A>
                  )}
                </For>
              </div>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
