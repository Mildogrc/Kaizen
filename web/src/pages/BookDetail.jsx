import { useNavigate, useParams } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { del, patch, post, useApi } from '../lib/api';
import { date, num, titleCase } from '../lib/format';
import { attempt } from '../lib/store';
import { ConceptChip, LinkSourceModal, roleLabel, useConceptLinks } from '../components/concepts';
import { Icon } from '../components/icons';
import { Badge, Card, Empty, Field, Load, Page, Pills, Progress, Section, Stat, StatGrid } from '../components/ui';
import { BOOK_STATUSES } from './Books';

const NOTE_KINDS = ['NOTE', 'QUOTE', 'SUMMARY', 'IDEA', 'CHARACTER', 'ARGUMENT', 'DEFINITION', 'FORMULA', 'PASSAGE', 'REFLECTION'];

function LogSession(props) {
  const [pages, setPages] = createSignal('');
  const [minutes, setMinutes] = createSignal('');
  const [endPage, setEndPage] = createSignal('');
  const [day, setDay] = createSignal(props.today);
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(() => post(`/books/${props.bookId}/sessions`, {
      pagesRead: Number(pages() || 0), durationMin: Number(minutes() || 0), endPage: endPage() ? Number(endPage()) : null, readAt: day(),
    }), 'Reading session logged');
    if (r) { setPages(''); setMinutes(''); setEndPage(''); }
  };
  return (
    <form onSubmit={save} class="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field label="Pages read"><input class="input" type="number" min="0" required value={pages()} onInput={(e) => setPages(e.currentTarget.value)} /></Field>
      <Field label="Minutes"><input class="input" type="number" min="1" required value={minutes()} onInput={(e) => setMinutes(e.currentTarget.value)} /></Field>
      <Field label="Ended on page"><input class="input" type="number" min="1" value={endPage()} onInput={(e) => setEndPage(e.currentTarget.value)} /></Field>
      <Field label="Date"><input class="input" type="date" value={day()} max={props.today} onInput={(e) => setDay(e.currentTarget.value)} /></Field>
      <div class="sm:col-span-4"><button class="btn btn-primary">Log session</button></div>
    </form>
  );
}

function AddNote(props) {
  const [kind, setKind] = createSignal('NOTE');
  const [content, setContent] = createSignal('');
  const [location, setLocation] = createSignal('');
  const [remember, setRemember] = createSignal(false);
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(() => post(`/books/${props.bookId}/notes`, { kind: kind(), content: content(), location: location() || null, remember: remember() }));
    if (r) { setContent(''); setLocation(''); setRemember(false); }
  };
  return (
    <form onSubmit={save} class="space-y-3">
      <Pills value={kind()} onChange={setKind} options={NOTE_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
      <textarea class="input min-h-24" required value={content()} onInput={(e) => setContent(e.currentTarget.value)} placeholder="What’s worth keeping?" />
      <div class="flex flex-wrap items-center gap-3">
        <input class="input max-w-[220px]" value={location()} onInput={(e) => setLocation(e.currentTarget.value)} placeholder="Chapter / page" />
        <label class="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={remember()} onChange={(e) => setRemember(e.currentTarget.checked)} /> Remember this (flashcard-worthy)</label>
        <button class="btn btn-primary ml-auto">Add note</button>
      </div>
    </form>
  );
}

export default function BookDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const q = useApi(() => `/books/${params.id}`);
  return (
    <Load q={q}>
      {(d) => {
        const update = (body) => attempt(() => patch(`/books/${d.book.id}`, body));
        const [explaining, setExplaining] = createSignal(false);
        const links = useConceptLinks(() => `bookId=${d.book.id}`);
        const remove = async () => {
          if (!confirm(`Delete “${d.book.title}” with its notes and sessions?`)) return;
          await attempt(() => del(`/books/${d.book.id}`));
          navigate('/books');
        };
        return (
          <Page title={d.book.title} back={{ href: '/books', label: 'Books' }} subtitle={[d.book.author, d.book.category].filter(Boolean).join(' · ')}
            actions={<button class="btn btn-danger" onClick={remove}><Icon name="trash" size={14} /> Delete</button>}>
            <Card class="mb-5">
              <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Pills value={d.book.status} onChange={(status) => update({ status })} options={BOOK_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
                <div class="flex items-center gap-1" role="group" aria-label="Rating">
                  <For each={[1, 2, 3, 4, 5]}>{(n) => <button class={`text-[18px] ${d.book.rating >= n ? 'text-warn' : 'text-faint hover:text-warn'}`} onClick={() => update({ rating: n })} aria-label={`${n} stars`}>★</button>}</For>
                </div>
                <label class="flex items-center gap-2 text-[12.5px] text-muted">Pages
                  <input class="input h-8 w-24" type="number" min="0" value={d.book.pageCount ?? ''} onChange={(e) => update({ pageCount: Number(e.currentTarget.value || 0) })} />
                </label>
              </div>
              <div class="mt-2 text-[11.5px] text-faint">{d.book.startDate ? `Started ${date(d.book.startDate)}` : 'Not started'}{d.book.finishDate ? ` · finished ${date(d.book.finishDate)}` : ''}</div>
            </Card>
            <StatGrid>
              <Stat label="Current page" value={d.stats.currentPage ? num(d.stats.currentPage) : '—'} hint={d.book.pageCount ? `of ${num(d.book.pageCount)}` : undefined} />
              <Stat label="Pages logged" value={num(d.stats.pagesLogged)} />
              <Stat label="Time read" value={`${Math.floor(d.stats.minutes / 60)}h ${d.stats.minutes % 60}m`} />
              <Stat label="Pace" value={`${d.stats.pacePerHour} p/h`} />
            </StatGrid>
            <Show when={d.stats.progressPct != null}><Progress class="mb-6" value={d.stats.progressPct} color="var(--good)" /></Show>
            <div class="grid gap-5 xl:grid-cols-2">
              <div>
                <Section title="Log a reading session"><Card><LogSession bookId={d.book.id} today={d.today} /></Card></Section>
                <Section title={`Sessions (${d.sessions.length})`}>
                  <Show when={d.sessions.length} fallback={<Empty>No sessions logged yet.</Empty>}>
                    <Card pad={false}>
                      <div class="divide-y divide-line">
                        <For each={d.sessions}>
                          {(s) => (
                            <div class="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                              <span class="w-24 text-muted">{date(s.date)}</span>
                              <span class="tnum flex-1">{s.pagesRead} pages · {s.durationMin} min{s.endPage ? ` · to p.${s.endPage}` : ''}</span>
                              <span class="tnum text-faint">{s.pacePerHour} p/h</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Card>
                  </Show>
                </Section>
              </div>
              <div>
                <Section title="Concepts it teaches" actions={<button class="btn btn-sm" onClick={() => setExplaining(true)}><Icon name="plus" size={13} /> Link a concept</button>}>
                  <Show when={links.data()?.links?.length} fallback={<p class="text-[13px] text-muted">Link a chapter or page range to the concept it explains, and it shows up on that concept’s page.</p>}>
                    <Card pad={false}>
                      <div class="divide-y divide-line">
                        <For each={links.data().links}>
                          {(l) => (
                            <div class="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px]">
                              <ConceptChip id={l.conceptId} title={l.title} finished={l.finished} />
                              <span>{l.label}</span>
                              <Show when={l.range && l.range !== l.label}><span class="tnum text-muted">{l.range}</span></Show>
                              <span class="text-muted">· {roleLabel(l.role)}</span>
                              <Show when={l.status === 'SUGGESTED'}><span class="text-muted">· suggested</span></Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Card>
                  </Show>
                </Section>
                <Section title="Add a note"><Card><AddNote bookId={d.book.id} /></Card></Section>
                <Section title={`Notes (${d.notes.length})`}>
                  <Show when={d.notes.length} fallback={<Empty>No notes yet.</Empty>}>
                    <div class="space-y-2">
                      <For each={d.notes}>
                        {(n) => (
                          <Card class="p-3.5">
                            <div class="mb-1.5 flex items-center gap-2">
                              <Badge tone="accent">{titleCase(n.kind)}</Badge>
                              <Show when={n.location}><span class="text-[11.5px] text-faint">{n.location}</span></Show>
                              <span class="ml-auto flex items-center gap-1">
                                <button class={`btn btn-ghost btn-sm ${n.remember ? 'text-warn' : 'text-faint'}`} title="Remember" onClick={() => attempt(() => post(`/book-notes/${n.id}/remember`))}>★</button>
                                <button class="btn btn-ghost btn-sm text-faint" title="Delete" onClick={() => attempt(() => del(`/book-notes/${n.id}`))}><Icon name="trash" size={13} /></button>
                              </span>
                            </div>
                            <p class="whitespace-pre-wrap text-[13px]">{n.content}</p>
                          </Card>
                        )}
                      </For>
                    </div>
                  </Show>
                </Section>
              </div>
            </div>
            <Show when={explaining()}>
              <LinkSourceModal title="Which concept does this book explain?" role="RIGOROUS" onClose={() => setExplaining(false)}
                preset={{ kind: 'book', bookId: d.book.id, label: d.book.title }} />
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
