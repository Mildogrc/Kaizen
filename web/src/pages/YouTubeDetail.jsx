import { useNavigate, useParams } from '@solidjs/router';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { api, del, invalidate, post, useApi } from '../lib/api';
import { clock, duration, relative } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { ConceptChip, LinkSourceModal, useConceptLinks } from '../components/concepts';
import { Icon } from '../components/icons';
import { Card, CopyButton, Disclosure, Field, Load, Page, Progress, Section, Stat, StatGrid } from '../components/ui';

let ytApi;
function loadYouTubeApi() {
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
  }
  return ytApi;
}

/** Embedded player that reports progress every 10 seconds and on pause/end. */
function Player(props) {
  let host;
  let player;
  let timer;
  const report = (ended = false) => {
    if (!player?.getVideoData) return;
    const videoId = player.getVideoData()?.video_id;
    if (!videoId) return;
    api(`/youtube/${props.playlistId}/progress`, {
      method: 'POST',
      body: { videoId, position: Math.max(0, player.getPlaylistIndex?.() ?? props.position), seconds: player.getCurrentTime?.() ?? 0, ended },
    }).then(() => { if (ended) invalidate(); }).catch(() => {});
  };
  onMount(async () => {
    const YT = await loadYouTubeApi();
    player = new YT.Player(host, {
      videoId: props.videoId ?? undefined,
      playerVars: { list: props.youtubePlaylistId, listType: 'playlist', index: props.position, start: props.seconds, playsinline: 1, rel: 0 },
      events: {
        onStateChange: (e) => {
          clearInterval(timer);
          if (e.data === YT.PlayerState.PLAYING) timer = setInterval(() => report(false), 10000);
          if (e.data === YT.PlayerState.PAUSED) report(false);
          if (e.data === YT.PlayerState.ENDED) report(true);
        },
      },
    });
  });
  onCleanup(() => { clearInterval(timer); report(false); player?.destroy?.(); });
  return <div class="aspect-video w-full overflow-hidden rounded-lg bg-black"><div ref={host} class="h-full w-full" /></div>;
}

function Artwork(props) {
  const [url, setUrl] = createSignal('');
  let file;
  const save = async (e) => {
    e.preventDefault();
    const form = new FormData();
    if (file?.files?.[0]) form.append('imageFile', file.files[0]);
    if (url().trim()) form.append('imageUrl', url().trim());
    const r = await attempt(() => api(`/youtube/${props.id}/artwork`, { method: 'POST', body: form }));
    if (r) { toast(r.message, 'good'); invalidate(); }
  };
  return (
    <form onSubmit={save} class="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <Field label="Upload an image (PNG, JPEG, WebP, GIF · 8 MB)"><input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="input py-1.5" /></Field>
      <Field label="…or an image URL"><input class="input" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://…" /></Field>
      <button class="btn btn-primary">Save artwork</button>
    </form>
  );
}

export default function YouTubeDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const q = useApi(() => `/youtube/${params.id}`);
  const [refreshing, setRefreshing] = createSignal(false);
  return (
    <Load q={q}>
      {(d) => {
        const [itemId, setItemId] = createSignal(d.current?.id);
        const [explaining, setExplaining] = createSignal(null);
        const links = useConceptLinks(() => `playlistId=${d.playlist.id}`);
        const chips = (videoId) => links.data()?.videos?.[videoId] ?? [];
        const [minutes, setMinutes] = createSignal(Math.floor(d.playlist.currentSeconds / 60));
        const [seconds, setSeconds] = createSignal(d.playlist.currentSeconds % 60);
        const refresh = async () => {
          setRefreshing(true);
          await attempt(() => post(`/youtube/${d.playlist.id}/refresh`), (r) => r.message);
          setRefreshing(false);
        };
        const remove = async () => {
          if (!confirm(`Remove “${d.playlist.title}” and its progress?`)) return;
          await attempt(() => del(`/youtube/${d.playlist.id}`));
          navigate('/youtube');
        };
        const setPosition = (e) => {
          e.preventDefault();
          attempt(() => post(`/youtube/${d.playlist.id}/position`, { itemId: itemId(), minutes: Number(minutes()), seconds: Number(seconds()), recordProgress: true }), 'Position saved');
        };
        return (
          <Page title={d.playlist.title} back={{ href: '/youtube', label: 'YouTube playlists' }}
            subtitle={[d.playlist.channelTitle, `${d.total} lectures`].filter(Boolean).join(' · ')}
            actions={<>
              <a href={d.watchUrl} target="_blank" rel="noreferrer" class="btn"><Icon name="external" size={14} /> YouTube</a>
              <button class="btn" disabled={refreshing()} onClick={refresh}><Icon name="sync" size={14} class={refreshing() ? 'animate-spin' : ''} /> Refresh</button>
              <button class="btn btn-danger" onClick={remove}><Icon name="trash" size={14} /></button>
            </>}>
            <StatGrid cols="md:grid-cols-5">
              <Stat label="Completed" value={`${d.completed}/${d.total}`} />
              <Stat label="Watched" value={d.progress.percentageLabel} hint={d.progress.timeLabel} />
              <Stat label="Total time" value={d.runtime.label} hint={d.runtime.hint} />
              <Stat label="Current lecture" value={d.current ? d.current.position + 1 : '—'} />
              <Stat label="Resume at" value={clock(d.playlist.currentSeconds)} />
            </StatGrid>
            <Progress class="mb-6" value={d.progress.percentage ?? 0} color="#ef4444" />
            <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <Section title="Watch">
                  <Card>
                    <Show when={d.current} fallback={<p class="text-[13px] text-muted">This playlist has no lectures yet. Try Refresh.</p>}>
                      <Player playlistId={d.playlist.id} youtubePlaylistId={d.playlist.youtubePlaylistId} videoId={d.current.videoId} position={d.current.position} seconds={d.playlist.currentSeconds} />
                      <div class="mt-2 flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="text-[13px] font-medium">{d.current.position + 1}. {d.current.title}</div>
                          <Show when={chips(d.current.videoId).length}>
                            <div class="mt-1.5 flex flex-wrap gap-1">
                              <For each={chips(d.current.videoId)}>{(c) => <ConceptChip id={c.conceptId} title={c.title} finished={c.finished} hint={[c.title, c.range].filter(Boolean).join(' · ')} />}</For>
                            </div>
                          </Show>
                        </div>
                        <button class="btn btn-sm shrink-0" onClick={() => setExplaining(d.current)}>This explains…</button>
                      </div>
                    </Show>
                  </Card>
                </Section>
                <Section title="Set where you are">
                  <Card>
                    <form onSubmit={setPosition} class="grid gap-3 md:grid-cols-[1fr_6rem_6rem_auto] md:items-end">
                      <Field label="Lecture">
                        <select class="input" value={itemId()} onChange={(e) => setItemId(e.currentTarget.value)}>
                          <For each={d.items}>{(i) => <option value={i.id}>{i.position + 1}. {i.title}</option>}</For>
                        </select>
                      </Field>
                      <Field label="Minutes"><input class="input" type="number" min="0" value={minutes()} onInput={(e) => setMinutes(e.currentTarget.value)} /></Field>
                      <Field label="Seconds"><input class="input" type="number" min="0" max="59" value={seconds()} onInput={(e) => setSeconds(e.currentTarget.value)} /></Field>
                      <button class="btn btn-primary">Set position</button>
                    </form>
                    <p class="mt-2 text-[11.5px] text-faint">Earlier lectures are marked complete.</p>
                  </Card>
                </Section>
              </div>
              <Section title={`Lectures (${d.items.length})`}>
                <Card pad={false} class="max-h-[640px] overflow-y-auto">
                  <div class="divide-y divide-line">
                    <For each={d.items}>
                      {(i) => (
                        <div class={`flex items-center gap-2.5 px-3 py-2 text-[12.5px] ${d.current?.id === i.id ? 'bg-accent-soft' : ''}`}>
                          <span class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${i.completed ? 'bg-good text-white' : 'bg-surface-3 text-muted'}`}>{i.completed ? '✓' : i.position + 1}</span>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate" title={i.title}>{i.title}</span>
                            <Show when={chips(i.videoId).length}>
                              <span class="mt-1 flex flex-wrap gap-1">
                                <For each={chips(i.videoId)}>{(c) => <ConceptChip id={c.conceptId} title={c.title} finished={c.finished} hint={[c.title, c.range].filter(Boolean).join(' · ')} />}</For>
                              </span>
                            </Show>
                          </span>
                          <span class="tnum shrink-0 text-[11px] text-faint">{i.durationSeconds ? duration(i.durationSeconds) : ''}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Card>
              </Section>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <Disclosure title="Artwork">
                <Artwork id={d.playlist.id} />
              </Disclosure>
              <Disclosure title="AI artwork prompt">
                <Show when={d.playlist.imagePrompt} fallback={<p class="mb-2 text-[12.5px] text-muted">Generate a prompt for an image model from the lecture titles.</p>}>
                  <pre class="mb-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-muted">{d.playlist.imagePrompt}</pre>
                </Show>
                <div class="flex gap-2">
                  <button class="btn btn-sm" onClick={() => attempt(() => post(`/youtube/${d.playlist.id}/image-prompt`))}>{d.playlist.imagePrompt ? 'Regenerate' : 'Generate prompt'}</button>
                  <Show when={d.playlist.imagePrompt}><CopyButton small text={() => d.playlist.imagePrompt} /></Show>
                </div>
              </Disclosure>
            </div>
            <Show when={explaining()}>
              {(item) => (
                <LinkSourceModal title="Which concept does this lecture explain?" role="LECTURE" onClose={() => setExplaining(null)}
                  preset={{ kind: 'video', playlistId: d.playlist.id, videoId: item().videoId, label: `${item().position + 1}. ${item().title}` }} />
              )}
            </Show>
            <p class="mt-4 text-[11.5px] text-faint">Metadata from {d.playlist.metadataSource} · fetched {relative(d.playlist.lastFetchedAt)}</p>
          </Page>
        );
      }}
    </Load>
  );
}
