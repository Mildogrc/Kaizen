import { useNavigate, useParams } from '@solidjs/router';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { api, del, invalidate, post, useApi } from '../lib/api';
import { clock, duration, relative } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { ConceptChip, LinkSourceModal, useConceptLinks } from '../components/concepts';
import { Icon } from '../components/icons';
import { LessonRow } from '../components/tracks';
import { ai } from '../lib/ai';
import { setCourseStatus } from './YouTube';
import { Card, CopyButton, Disclosure, Field, Load, Metric, MetricRow, Page, Pills, Progress, Section } from '../components/ui';

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

/** The two cover styles: a plain two-colour panel, or a prompt for an image model. */
function Cover(props) {
  const d = () => props.d;
  const art = () => d().art;
  const [name, setName] = createSignal(art().name);
  const [pairing, setPairing] = createSignal(art().pairing);
  const [style, setStyle] = createSignal(art().style === 'artistic' ? 'artistic' : 'simple');
  const [naming, setNaming] = createSignal(false);
  const pair = () => art().pairings[pairing()];
  const shuffle = () => {
    const others = art().pairings.map((_, i) => i).filter((i) => i !== pairing());
    setPairing(others[Math.floor(Math.random() * others.length)]);
  };
  const suggest = async () => {
    setNaming(true);
    const r = await attempt(() => post(`/youtube/${d().playlist.id}/art/name`, undefined, { refresh: false }));
    if (r?.name) setName(r.name);
    setNaming(false);
  };
  const save = (asSimple) =>
    attempt(() => post(`/youtube/${d().playlist.id}/art`, { name: name(), pairing: pairing(), style: asSimple ? 'simple' : null }),
      asSimple ? 'Cover updated' : 'Prompt updated');
  return (
    <div class="space-y-4">
      <Field label="Name on the cover">
        <div class="flex flex-wrap gap-2">
          <input class="input min-w-[200px] flex-1" maxLength={40} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          <button class="btn" disabled={naming()} onClick={suggest}><Icon name="sparkle" size={14} /> {naming() ? 'Thinking…' : 'Suggest'}</button>
        </div>
      </Field>
      <Field label={`Colours · ${pair().name}`}>
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={art().pairings}>
            {(p, i) => (
              <button type="button" class="pill !px-1.5" aria-pressed={pairing() === i()} title={p.name} aria-label={p.name} onClick={() => setPairing(i())}>
                <span class="flex h-5 w-8 overflow-hidden rounded-full border border-line"><span class="flex-1" style={{ background: p.background }} /><span class="flex-1" style={{ background: p.ink }} /></span>
              </button>
            )}
          </For>
          <button type="button" class="btn btn-ghost btn-sm" onClick={shuffle}>Shuffle</button>
        </div>
      </Field>
      <div class="flex aspect-video w-full max-w-md flex-col justify-end overflow-hidden rounded-lg p-[6%]" style={{ background: pair().background, color: pair().ink }} aria-label="Cover preview">
        <span class="mb-[4%] block h-[1.6%] w-[7.5%] min-h-[3px]" style={{ background: pair().ink }} />
        <span class="text-[clamp(22px,5.5vw,40px)] font-bold leading-[1.05] tracking-tight">{name() || 'Course name'}</span>
      </div>
      <Field label="Style">
        <Pills value={style()} onChange={setStyle} options={[{ value: 'simple', label: 'Simple' }, { value: 'artistic', label: 'Artistic (AI image)' }]} />
      </Field>
      <Show when={style() === 'simple'} fallback={
        <div class="space-y-2">
          <p class="text-[13px] text-muted">Paste this into an image model, then upload the result below. It uses the same name and colours.</p>
          <div class="flex gap-2">
            <button class="btn btn-sm" onClick={() => save(false)}>Update the prompt</button>
            <Show when={d().playlist.imagePrompt}><CopyButton small text={() => d().playlist.imagePrompt} /></Show>
          </div>
          <Show when={d().playlist.imagePrompt}><pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[12px] text-muted">{d().playlist.imagePrompt}</pre></Show>
        </div>
      }>
        <button class="btn btn-primary" disabled={!name().trim()} onClick={() => save(true)}>Use this cover</button>
      </Show>
    </div>
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
          navigate('/library');
        };
        const askLecture = () => ai.ask({
          kind: 'lecture', ref: d.current.videoId, title: `Lecture ${d.current.position + 1}`, resume: true,
          prompt: `I'm watching lecture ${d.current.position + 1}, "${d.current.title}", from the course "${d.playlist.title}". Give me a short overview of what it covers and the prerequisites it assumes, then let me ask questions.`,
        });
        const waiting = useApi(() => `/library/lesson-cards?playlistId=${d.playlist.id}`);
        const waitingFor = (videoId) => waiting.data()?.videos?.[videoId] ?? [];
        const lessonMeta = (i) => [i.durationSeconds ? duration(i.durationSeconds) : null, d.current?.id === i.id ? 'up next' : null].filter(Boolean).join(' · ') || undefined;
        const wake = (card) => attempt(() => post('/anki/unsuspend', { tag: card.tag }), (r) => `Unsuspended ${r.unsuspended} cards`);
        const setPosition = (e) => {
          e.preventDefault();
          attempt(() => post(`/youtube/${d.playlist.id}/position`, { itemId: itemId(), minutes: Number(minutes()), seconds: Number(seconds()), recordProgress: true }), 'Position saved');
        };
        return (
          <Page title={d.playlist.title} back={{ href: '/library', label: 'Library' }}
            subtitle={[d.playlist.channelTitle, `${d.total} lectures`].filter(Boolean).join(' · ')}
            actions={<>
              <Show when={d.playlist.status !== 'COMPLETED'}>
                <Pills label="Course status" value={d.playlist.status} onChange={(status) => setCourseStatus(d.playlist.id, status)}
                  options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Back burner' }]} />
              </Show>
              <button class="btn" disabled={!d.current} onClick={askLecture}><Icon name="sparkle" size={14} /> Ask about this lecture</button>
              <a href={d.watchUrl} target="_blank" rel="noreferrer" class="btn"><Icon name="external" size={14} /> YouTube</a>
              <button class="btn" disabled={refreshing()} onClick={refresh}><Icon name="sync" size={14} class={refreshing() ? 'animate-spin' : ''} /> Refresh</button>
              <button class="btn btn-danger" onClick={remove}><Icon name="trash" size={14} /></button>
            </>}>
            <MetricRow>
              <Metric noun="Next lesson" value={d.current ? `Lecture ${d.current.position + 1}` : '—'} meaning={d.current?.title} />
              <Metric noun="Left to watch" value={`${Math.max(0, d.total - (d.current?.position ?? 0))} lectures`} meaning={d.runtime.label === 'Unavailable' ? d.runtime.hint : `${d.runtime.label} in all`} />
              <Metric noun="Resume at" value={clock(d.playlist.currentSeconds)} meaning={d.playlist.currentSeconds ? 'where you stopped' : 'from the beginning'} />
            </MetricRow>
            <Progress class="mb-6" value={d.progress.percentage ?? 0} color="var(--video)" />
            <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <Section title="Next lesson">
                  <Card>
                    <Show when={d.current} fallback={<p class="text-[13px] text-muted">This course has no lectures yet. Try Refresh.</p>}>
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
                    <p class="mt-2 text-[12px] text-muted">Earlier lectures are marked complete.</p>
                  </Card>
                </Section>
              </div>
              <Section title="Lessons">
                <Card pad={false} class="max-h-[640px] overflow-y-auto">
                  <For each={d.items}>
                    {(i) => (
                      <LessonRow number={i.position + 1} title={i.title} done={i.completed} current={d.current?.id === i.id} meta={lessonMeta(i)}
                        below={
                          <Show when={chips(i.videoId).length}>
                            <span class="mt-1 flex flex-wrap gap-1">
                              <For each={chips(i.videoId)}>{(c) => <ConceptChip id={c.conceptId} title={c.title} finished={c.finished} hint={[c.title, c.range].filter(Boolean).join(' · ')} />}</For>
                            </span>
                          </Show>
                        }>
                        <Show when={i.completed || d.current?.id === i.id}>
                          <For each={waitingFor(i.videoId)}>{(card) => <button class="btn btn-sm shrink-0" onClick={() => wake(card)}>Unsuspend {card.waiting} cards</button>}</For>
                        </Show>
                      </LessonRow>
                    )}
                  </For>
                </Card>
              </Section>
            </div>
            <div class="grid items-start gap-3 md:grid-cols-2">
              <Disclosure title="Cover"><Cover d={d} /></Disclosure>
              <Disclosure title="Upload your own cover"><Artwork id={d.playlist.id} /></Disclosure>
            </div>
            <Show when={explaining()}>
              {(item) => (
                <LinkSourceModal title="Which concept does this lecture explain?" role="LECTURE" onClose={() => setExplaining(null)}
                  preset={{ kind: 'video', playlistId: d.playlist.id, videoId: item().videoId, label: `${item().position + 1}. ${item().title}` }} />
              )}
            </Show>
            <p class="mt-4 text-[12px] text-muted">Metadata from {d.playlist.metadataSource} · fetched {relative(d.playlist.lastFetchedAt)}</p>
          </Page>
        );
      }}
    </Load>
  );
}
