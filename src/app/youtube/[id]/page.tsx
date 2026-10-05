import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { Badge, Card, PageHeader, Section, StatCard, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { buildYouTubeEmbedUrl, youtubePlaylistRuntime } from '@/lib/youtube-playlists';
import { youtubePlaylistProgress } from '@/lib/youtube-progress';
import { ArtworkForm } from '../artwork-form';
import { CopyPrompt } from '../copy-prompt';
import { deleteYouTubePlaylist, setYouTubePlaylistPosition } from '../actions';
import { PlaylistMetadataActions } from '../playlist-actions';
import { YouTubePlayer } from '../youtube-player';
import { WatchProgress } from '../watch-progress';

export const dynamic = 'force-dynamic';

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default async function YouTubePlaylistDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlist = await prisma.youTubePlaylist.findUnique({
    where: { id },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (!playlist) notFound();

  const currentItem = playlist.items.find((item) => item.youtubeVideoId === playlist.currentVideoId)
    ?? playlist.items.find((item) => item.position === playlist.currentPosition)
    ?? playlist.items[0]
    ?? null;
  const finished = playlist.items.filter((item) => item.completed).length;
  const total = Math.max(playlist.totalItems, playlist.items.length);
  const progress = youtubePlaylistProgress(playlist.items, total, playlist);
  const progressKey = `${playlist.updatedAt.getTime()}-${progress.watchedSeconds}-${progress.totalSeconds}`;
  const runtime = youtubePlaylistRuntime(playlist.items, total);
  const watchOnYouTube = currentItem
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(currentItem.youtubeVideoId)}&list=${encodeURIComponent(playlist.youtubePlaylistId)}&index=${currentItem.position + 1}&t=${playlist.currentSeconds}s`
    : playlist.sourceUrl;
  const fallbackEmbedUrl = buildYouTubeEmbedUrl({
    playlistId: playlist.youtubePlaylistId,
    videoId: currentItem?.youtubeVideoId,
    position: currentItem?.position ?? 0,
    seconds: playlist.currentSeconds,
  });

  return (
    <>
      <div className="mb-1 text-[12px]"><Link href="/youtube" className="text-muted hover:text-foreground">← YouTube Playlists</Link></div>
      <PageHeader
        title={playlist.title}
        subtitle={[playlist.channelTitle, `${total || playlist.items.length} lectures`].filter(Boolean).join(' · ')}
        actions={<a href={watchOnYouTube} target="_blank" rel="noreferrer" className={btnCls}>Open in YouTube ↗</a>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Completed" value={`${finished}/${total || '—'}`} />
        <WatchProgress key={progressKey} playlistId={playlist.id} initialProgress={progress} display="stat" />
        <StatCard label="Total time" value={runtime.label} hint={runtime.hint} />
        <StatCard label="Current lecture" value={currentItem ? currentItem.position + 1 : '—'} />
        <StatCard label="Resume time" value={formatTime(playlist.currentSeconds)} />
      </div>

      <WatchProgress key={progressKey} playlistId={playlist.id} initialProgress={progress} display="bar" />

      <Section title="Watch in Kaizen">
        <Card>
          <YouTubePlayer
            key={`${currentItem?.youtubeVideoId ?? 'playlist'}-${playlist.currentSeconds}`}
            playlistDatabaseId={playlist.id}
            youtubePlaylistId={playlist.youtubePlaylistId}
            videoId={currentItem?.youtubeVideoId ?? null}
            position={currentItem?.position ?? 0}
            seconds={playlist.currentSeconds}
          />
          <noscript><iframe title={playlist.title} src={fallbackEmbedUrl} className="mt-3 aspect-video w-full" allowFullScreen /></noscript>
        </Card>
      </Section>

      {playlist.items.length > 0 && <Section title="Set where you are">
        <Card>
          <form action={setYouTubePlaylistPosition.bind(null, playlist.id)} className="grid gap-2 md:grid-cols-[1fr_7rem_6rem_auto] md:items-end">
            <input type="hidden" name="recordProgress" value="true" />
            <label className="text-[11px] text-muted">Lecture<select name="itemId" defaultValue={currentItem?.id} className={`${inputCls} mt-1`}>{playlist.items.map((item) => <option key={item.id} value={item.id}>{item.position + 1}. {item.title}</option>)}</select></label>
            <label className="text-[11px] text-muted">Minutes<input name="minutes" type="number" min="0" defaultValue={Math.floor(playlist.currentSeconds / 60)} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Seconds<input name="seconds" type="number" min="0" max="59" defaultValue={playlist.currentSeconds % 60} className={`${inputCls} mt-1`} /></label>
            <button type="submit" className={btnPrimaryCls}>Set position</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">Setting your position counts earlier lectures as watched and saves the selected lecture up to this timestamp.</p>
        </Card>
      </Section>}

      <Section title="Lectures">
        <Card className="max-h-[32rem] overflow-y-auto p-0">
          {playlist.items.length === 0 ? <p className="p-4 text-[12px] text-muted">Lecture names were not available. The embedded playlist can still play; add a YOUTUBE_API_KEY and refresh for complete metadata.</p> : playlist.items.map((item) => (
            <form key={item.id} action={setYouTubePlaylistPosition.bind(null, playlist.id)} className={`border-b border-line/70 last:border-0 ${item.id === currentItem?.id ? 'bg-accent/5' : ''}`}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="minutes" value="0" />
              <input type="hidden" name="seconds" value="0" />
              <button type="submit" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2/60">
                <span className={`w-5 text-center text-[11px] ${item.completed ? 'text-green-400' : 'text-muted'}`}>{item.completed ? '✓' : item.position + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{item.title}</span>
                {item.watchedSeconds > 0 && <span className="text-[10px] text-muted">saved {formatTime(item.watchedSeconds)}</span>}
                {item.id === currentItem?.id && <Badge tone="blue">current</Badge>}
              </button>
            </form>
          ))}
        </Card>
      </Section>

      <Section title="Playlist artwork" actions={<PlaylistMetadataActions playlistId={playlist.id} />}>
        <Card className="space-y-4">
          {playlist.imagePrompt ? <div>
            <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[12px] font-medium">GPT image prompt</span><CopyPrompt prompt={playlist.imagePrompt} /></div>
            <textarea readOnly value={playlist.imagePrompt} rows={10} className={`${inputCls} font-mono text-[11px]`} />
          </div> : <p className="text-[12px] text-muted">Generate a prompt from the playlist description and every imported lecture title, then paste it into GPT to create custom cover art.</p>}
          <ArtworkForm playlistId={playlist.id} />
          <p className="text-[10px] text-muted">Metadata source: {playlist.metadataSource === 'youtube-api' ? 'YouTube Data API' : 'public YouTube page'}{playlist.lastFetchedAt ? ` · refreshed ${playlist.lastFetchedAt.toLocaleString()}` : ''}</p>
        </Card>
      </Section>

      {playlist.description && <Section title="Description"><Card><p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{playlist.description}</p></Card></Section>}

      <Section title="Remove playlist">
        <form action={deleteYouTubePlaylist.bind(null, playlist.id)}><button type="submit" className="text-[11px] text-red-400 hover:underline">Delete this playlist and its saved position</button></form>
      </Section>
    </>
  );
}
