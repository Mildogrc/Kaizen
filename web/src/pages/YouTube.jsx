import { A, useNavigate } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { toast } from '../lib/store';
import { Badge, Card, Empty, Load, Page, Progress, Section, Stat, StatGrid, toneFor } from '../components/ui';

function AddPlaylist() {
  const navigate = useNavigate();
  const [url, setUrl] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/youtube', { url: url() });
      toast(r.message, 'good');
      navigate(`/youtube/${r.playlistId}`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={add} class="flex flex-wrap gap-2">
      <input class="input max-w-xl flex-1" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://www.youtube.com/playlist?list=…" required />
      <button class="btn btn-primary" disabled={busy()}>{busy() ? 'Importing lectures…' : 'Add playlist'}</button>
    </form>
  );
}

export default function YouTube() {
  const q = useApi(() => '/youtube');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="YouTube playlists" glyph="▶" back={{ href: '/skills', label: 'Skills' }} subtitle="Work through lecture series without losing your place">
          <StatGrid cols="md:grid-cols-3">
            <Stat label="Playlists" value={d.stats.playlists} />
            <Stat label="Active" value={d.stats.active} />
            <Stat label="Lectures finished" value={d.stats.lecturesFinished} />
          </StatGrid>
          <Card class="mb-6"><AddPlaylist /><p class="mt-2 text-[11.5px] text-faint">Kaizen imports the title, description, artwork, and lecture order. Public playlists work best.</p></Card>
          <Section title="Your playlists">
            <Show when={d.playlists.length} fallback={<Empty>No playlists yet.</Empty>}>
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <For each={d.playlists}>
                  {(p) => (
                    <A href={`/youtube/${p.id}`} class="card group block overflow-hidden p-0 transition-colors hover:border-line-strong">
                      <div class="aspect-video bg-surface-3 bg-cover bg-center" style={p.image ? { 'background-image': `url(${JSON.stringify(p.image)})` } : undefined}>
                        <Show when={!p.image}><div class="flex h-full items-center justify-center text-[34px] text-faint">▶</div></Show>
                      </div>
                      <div class="p-4">
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="line-clamp-2 text-[14px] font-semibold">{p.title}</div>
                            <div class="truncate text-[11.5px] text-muted">{p.channelTitle ?? 'YouTube'}</div>
                          </div>
                          <Badge tone={toneFor(p.status)}>{p.status.toLowerCase()}</Badge>
                        </div>
                        <Progress class="mt-3" value={p.progress.percentage ?? (p.total ? (p.completed / p.total) * 100 : 0)} color="#ef4444" />
                        <div class="tnum mt-1.5 flex justify-between text-[11.5px] text-muted">
                          <span>{p.completed}/{p.total} lectures · {p.progress.percentageLabel}</span>
                          <span>{p.runtime.label}</span>
                        </div>
                      </div>
                    </A>
                  )}
                </For>
              </div>
            </Show>
          </Section>
        </Page>
      )}
    </Load>
  );
}
