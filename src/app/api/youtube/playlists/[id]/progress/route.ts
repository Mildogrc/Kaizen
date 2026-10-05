import { z } from 'zod';
import { prisma } from '@/lib/db';
import { youtubePlaybackUpdate, youtubePlaylistProgress } from '@/lib/youtube-progress';
import { revalidatePath } from 'next/cache';

const ProgressPayload = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
  position: z.number().int().min(0).max(100_000),
  seconds: z.number().finite().min(0).max(10_000_000),
  ended: z.boolean().optional().default(false),
});

export async function POST(request: Request, context: RouteContext<'/api/youtube/playlists/[id]/progress'>) {
  const { id } = await context.params;
  const parsed = ProgressPayload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid playback progress.' }, { status: 400 });

  const playlist = await prisma.youTubePlaylist.findUnique({
    where: { id },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (!playlist) return Response.json({ error: 'Playlist not found.' }, { status: 404 });

  const current = playlist.items.find((item) => item.youtubeVideoId === parsed.data.videoId && item.position === parsed.data.position)
    ?? playlist.items.find((item) => item.youtubeVideoId === parsed.data.videoId);
  if (!current) return Response.json({ error: 'Lecture not found in this playlist.' }, { status: 400 });

  const update = youtubePlaybackUpdate(current, parsed.data.seconds, parsed.data.ended);
  const items = playlist.items.map((item) => item.id === current.id ? { ...item, ...update } : item);
  const progress = youtubePlaylistProgress(items, playlist.totalItems);
  await prisma.$transaction([
    prisma.youTubePlaylistItem.update({
      where: { id: current.id },
      data: { watchedSeconds: update.watchedSeconds, completed: update.completed },
    }),
    prisma.youTubePlaylist.update({
      where: { id },
      data: {
        currentVideoId: current.youtubeVideoId,
        currentPosition: current.position,
        currentSeconds: update.currentSeconds,
        status: progress.percentage === 100 ? 'COMPLETED' : 'ACTIVE',
      },
    }),
  ]);

  revalidatePath('/youtube');
  revalidatePath(`/youtube/${id}`);
  return Response.json({ ok: true, progress });
}
