import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { useApi } from '../lib/api';
import { num } from '../lib/format';
import { Card, Empty, Load, Page, Section } from '../components/ui';

export default function ReadingTrack() {
  const q = useApi(() => '/books');
  return (
    <Load q={q}>
      {(d) => {
        const reading = () => d.books.filter((b) => b.status === 'READING');
        const worth = () => d.books.filter((b) => b.remember > 0);
        return (
          <Page title="Reading" glyph="❦" back={{ href: '/tracks', label: 'Tracks' }} subtitle="The books you’re in the middle of, and what you marked to remember"
            actions={<A href="/library/books" class="btn">All books</A>}>
            <Section title="Now reading">
              <Show when={reading().length} fallback={<Empty>Nothing in progress. <A class="text-accent-text underline" href="/library/books">Pick a book</A> to start.</Empty>}>
                <div class="grid gap-3 sm:grid-cols-2">
                  <For each={reading()}>
                    {(b) => (
                      <A href={`/library/books/${b.id}`} class="card flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
                        <span class="kz-glyph">❦</span>
                        <div class="min-w-0">
                          <div class="truncate text-[14px] font-semibold">{b.title}</div>
                          <div class="truncate text-[12px] text-muted">{b.author ?? 'Unknown author'}{b.notes ? ` · ${num(b.notes)} notes` : ''}</div>
                        </div>
                      </A>
                    )}
                  </For>
                </div>
              </Show>
            </Section>
            <Show when={worth().length}>
              <Section title="Marked to remember">
                <Card pad={false}>
                  <For each={worth()}>
                    {(b) => <A href={`/library/books/${b.id}`} class="kz-task"><span class="kz-task__title min-w-0 truncate">{b.title}</span><span class="kz-task__detail">{num(b.remember)} notes</span></A>}
                  </For>
                </Card>
              </Section>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
