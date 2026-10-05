import Link from 'next/link';
import { AddPlaylistForm } from './add-playlist-form';
import { prisma } from '@/lib/db';
import { youtubePlaylistRuntime } from '@/lib/youtube-playlists';
import { youtubePlaylistProgress } from '@/lib/youtube-progress';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, statusTone } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function YouTubePlaylistsPage() {
  const playlists = await prisma.youTubePlaylist.findMany({
    include: { items: { select: { completed: true, position: true, durationSeconds: true, watchedSeconds: true } } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });
  const completedLectures = playlists.reduce((sum, playlist) => sum + playlist.items.filter((item) => item.completed).length, 0);
  const active = playlists.filter((playlist) => playlist.status === 'ACTIVE').length;

  return (
    <>
      <PageHeader title="YouTube Playlists" subtitle="Work through lecture series without losing your place" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Playlists" value={playlists.length} />
        <StatCard label="Active" value={active} />
        <StatCard label="Lectures finished" value={completedLectures} />
      </div>

      <Section title="Add a playlist">
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Drop in a YouTube playlist URL</summary>
          <div className="border-t border-line p-4">
            <AddPlaylistForm />
            <p className="mt-2 text-[11px] text-muted">Kaizen imports the playlist name, description, image, and lecture order. Public playlists work best.</p>
          </div>
        </details>
      </Section>

      <Section title="Your playlists">
        {playlists.length === 0 ? <EmptyState>No playlists yet — add one above to start tracking it.</EmptyState> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {playlists.map((playlist) => {
              const total = Math.max(playlist.totalItems, playlist.items.length);
              const progress = youtubePlaylistProgress(playlist.items, total, playlist);
              const runtime = youtubePlaylistRuntime(playlist.items, total);
              const image = playlist.customImageUrl ?? playlist.thumbnailUrl;
              return (
                <Link key={playlist.id} href={`/youtube/${playlist.id}`}>
                  <Card className="group h-full overflow-hidden p-0 transition-colors hover:border-accent/50">
                    <div
                      className="aspect-video border-b border-line bg-surface-2 bg-cover bg-center"
                      style={image ? { backgroundImage: `linear-gradient(to top, rgba(11,14,20,.48), transparent 55%), url(${JSON.stringify(image)})` } : undefined}
                    >
                      {!image && <div className="flex h-full items-center justify-center text-4xl text-muted">▶</div>}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="line-clamp-2 text-[15px] font-semibold">{playlist.title}</h2>
                          <p className="mt-0.5 truncate text-[11px] text-muted">{playlist.channelTitle ?? 'YouTube'}</p>
                        </div>
                        <Badge tone={statusTone(playlist.status)}>{playlist.status.toLowerCase()}</Badge>
                      </div>
                      <p className="mt-3 text-[12px] text-muted" title={runtime.hint}>Total time: <span className="font-medium text-foreground">{runtime.label}</span></p>
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-[11px] text-muted">
                          <span>{progress.timeLabel}</span>
                          <span>{progress.percentageLabel}</span>
                        </div>
                        <ProgressBar pct={progress.percentage ?? 0} />
                      </div>
                      <div className="mt-4 text-[12px] text-accent">Watch from where you left off →</div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
