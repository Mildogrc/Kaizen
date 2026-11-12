import { A, useNavigate } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { attempt, toast } from '../lib/store';
import { LIBRARY_TABS } from '../lib/nav';
import { Card, Empty, Load, Page, Progress, Section, SubNav } from '../components/ui';

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
      navigate(`/library/courses/${r.playlistId}`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={add} class="flex flex-wrap gap-2">
      <input class="input max-w-xl flex-1" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://www.youtube.com/playlist?list=…" required />
      <button class="btn btn-primary" disabled={busy()}>{busy() ? 'Bringing in lectures…' : 'Add a course'}</button>
    </form>
  );
}

export const setCourseStatus = (id, status) =>
  attempt(() => post(`/youtube/${id}/status`, { status }), status === 'ACTIVE' ? 'Back on your active list' : 'Moved to the back burner');

function CourseCard(props) {
  const p = () => props.course;
  const finished = () => p().status === 'COMPLETED' || (p().total && p().completed >= p().total);
  return (
    <div class="card group flex flex-col overflow-hidden p-0 transition-colors hover:border-line-strong">
      <A href={`/library/courses/${p().id}`} class="block">
        <div class="aspect-video bg-surface-3 bg-cover bg-center" style={p().image ? { 'background-image': `url(${JSON.stringify(p().image)})` } : undefined}>
          <Show when={!p().image}><div class="flex h-full items-center justify-center text-[22px] text-muted">▶</div></Show>
        </div>
        <div class="px-4 pt-3">
          <div class="line-clamp-2 text-[14px] font-semibold">{p().title}</div>
          <div class="truncate text-[12px] text-muted">{p().channelTitle ?? 'YouTube'}</div>
          <Progress class="mt-3" value={p().progress.percentage ?? (p().total ? (p().completed / p().total) * 100 : 0)} color="var(--video)" />
          <div class="tnum mt-1.5 flex justify-between text-[12px] text-muted">
            <span>{finished() ? 'Finished' : `Lecture ${p().currentPosition + 1} next · ${Math.max(0, p().total - p().currentPosition)} left`}</span>
            <span>{p().runtime.label === 'Unavailable' ? '' : p().runtime.label}</span>
          </div>
        </div>
      </A>
      <Show when={!finished()}>
        <div class="mt-auto flex justify-end px-4 pb-3 pt-2">
          <Show when={p().status === 'PAUSED'} fallback={<button class="btn btn-ghost btn-sm" onClick={() => setCourseStatus(p().id, 'PAUSED')}>Move to back burner</button>}>
            <button class="btn btn-sm" onClick={() => setCourseStatus(p().id, 'ACTIVE')}>Make active</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

const GROUPS = [
  { title: 'Active', note: 'On Today and your Tracks.', test: (p) => p.status === 'ACTIVE' && !(p.total && p.completed >= p.total) },
  { title: 'On the back burner', note: 'Kept here until you pick them up again.', test: (p) => p.status === 'PAUSED' },
  { title: 'Finished', test: (p) => p.status === 'COMPLETED' || (p.status === 'ACTIVE' && p.total && p.completed >= p.total) },
];

export default function YouTube() {
  const q = useApi(() => '/youtube');
  const [making, setMaking] = createSignal(false);
  const simpleCovers = async () => {
    setMaking(true);
    await attempt(() => post('/youtube/covers/simple'), (r) =>
      r.made ? `Made ${r.made} simple ${r.made === 1 ? 'cover' : 'covers'}${r.named === 'ai' ? ', named by your AI' : ''}.` : 'Every course already has its own cover.');
    setMaking(false);
  };
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Library" subtitle="Work through lecture series without losing your place"
          actions={<Show when={d.playlists.some((p) => !p.customImage)}><button class="btn" disabled={making()} onClick={simpleCovers}>{making() ? 'Making covers…' : 'Simple covers for the rest'}</button></Show>}>
          <SubNav label="Library" items={LIBRARY_TABS} />
          <Card class="mb-6"><AddPlaylist /><p class="mt-2 text-[12px] text-muted">Paste a YouTube playlist to start a course. Kaizen brings in the title, artwork, and lecture order; public playlists work best.</p></Card>
          <Show when={d.playlists.length} fallback={<Empty>No courses yet.</Empty>}>
            <For each={GROUPS}>
              {(g) => (
                <Show when={d.playlists.some(g.test)}>
                  <Section title={`${g.title} · ${d.playlists.filter(g.test).length}`}>
                    <Show when={g.note}><p class="-mt-1 mb-3 text-[12px] text-muted">{g.note}</p></Show>
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <For each={d.playlists.filter(g.test)}>{(p) => <CourseCard course={p} />}</For>
                    </div>
                  </Section>
                </Show>
              )}
            </For>
          </Show>
        </Page>
      )}
    </Load>
  );
}
