'use server';

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { youtubePlaybackUpdate } from '@/lib/youtube-progress';
import {
  buildYouTubeImagePrompt,
  fetchYouTubePlaylistMetadata,
  parseYouTubePlaylistId,
  type YouTubePlaylistMetadata,
} from '@/lib/youtube-playlists';

export interface YouTubeActionState {
  ok: boolean;
  error?: string;
  message?: string;
  playlistId?: string;
}

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Something went wrong. Please try again.';
}

async function saveMetadata(metadata: YouTubePlaylistMetadata) {
  const existing = await prisma.youTubePlaylist.findUnique({
    where: { youtubePlaylistId: metadata.playlistId },
    include: { items: true },
  });
  const existingByVideo = new Map(existing?.items.map((item) => [item.youtubeVideoId, item]) ?? []);
  const currentItem = metadata.items.find((item) => item.videoId === existing?.currentVideoId)
    ?? metadata.items.find((item) => item.position === existing?.currentPosition)
    ?? metadata.items[0];

  return prisma.$transaction(async (transaction) => {
    const playlist = await transaction.youTubePlaylist.upsert({
      where: { youtubePlaylistId: metadata.playlistId },
      create: {
        youtubePlaylistId: metadata.playlistId,
        sourceUrl: metadata.sourceUrl,
        title: metadata.title,
        description: metadata.description,
        channelTitle: metadata.channelTitle,
        thumbnailUrl: metadata.thumbnailUrl,
        currentVideoId: currentItem?.videoId ?? null,
        currentPosition: currentItem?.position ?? 0,
        totalItems: Math.max(metadata.totalItems, metadata.items.length),
        metadataSource: metadata.source,
        lastFetchedAt: new Date(),
      },
      update: {
        sourceUrl: metadata.sourceUrl,
        title: metadata.title,
        description: metadata.description,
        channelTitle: metadata.channelTitle,
        thumbnailUrl: metadata.thumbnailUrl,
        currentVideoId: currentItem?.videoId ?? null,
        currentPosition: currentItem?.position ?? 0,
        totalItems: Math.max(metadata.totalItems, metadata.items.length),
        metadataSource: metadata.source,
        lastFetchedAt: new Date(),
      },
    });

    await transaction.youTubePlaylistItem.deleteMany({ where: { playlistId: playlist.id } });
    if (metadata.items.length > 0) {
      await transaction.youTubePlaylistItem.createMany({
        data: metadata.items.map((item) => {
          const old = existingByVideo.get(item.videoId);
          return {
            playlistId: playlist.id,
            youtubeVideoId: item.videoId,
            position: item.position,
            title: item.title,
            description: item.description,
            thumbnailUrl: item.thumbnailUrl,
            publishedAt: item.publishedAt,
            durationSeconds: item.durationSeconds ?? old?.durationSeconds ?? null,
            completed: old?.completed ?? false,
            watchedSeconds: old?.watchedSeconds ?? 0,
          };
        }),
      });
    }
    return playlist;
  });
}

export async function addYouTubePlaylist(
  _previousState: YouTubeActionState,
  formData: FormData,
): Promise<YouTubeActionState> {
  const url = String(formData.get('url') ?? '').trim();
  try {
    parseYouTubePlaylistId(url);
    const playlist = await saveMetadata(await fetchYouTubePlaylistMetadata(url));
    revalidatePath('/youtube');
    revalidatePath('/skills');
    return { ok: true, playlistId: playlist.id, message: 'Playlist added.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function refreshYouTubePlaylist(playlistId: string): Promise<YouTubeActionState> {
  try {
    const playlist = await prisma.youTubePlaylist.findUnique({ where: { id: playlistId } });
    if (!playlist) return { ok: false, error: 'Playlist not found.' };
    await saveMetadata(await fetchYouTubePlaylistMetadata(playlist.youtubePlaylistId));
    revalidatePath('/youtube');
    revalidatePath(`/youtube/${playlistId}`);
    return { ok: true, message: 'Playlist details refreshed.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function setYouTubePlaylistPosition(playlistId: string, formData: FormData) {
  const itemId = String(formData.get('itemId') ?? '');
  const minutes = Math.max(0, Math.floor(Number(formData.get('minutes')) || 0));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(formData.get('seconds')) || 0)));
  if (!Number.isFinite(minutes) || minutes * 60 + seconds > 10_000_000) return;
  const item = await prisma.youTubePlaylistItem.findFirst({ where: { id: itemId, playlistId } });
  if (!item) return;
  const progress = youtubePlaybackUpdate(item, minutes * 60 + seconds);
  const recordProgress = formData.get('recordProgress') === 'true';
  await prisma.$transaction(async (transaction) => {
    if (recordProgress) {
      await transaction.youTubePlaylistItem.updateMany({
        where: { playlistId, position: { lt: item.position } },
        data: { completed: true },
      });
      await transaction.youTubePlaylistItem.update({
        where: { id: item.id },
        data: { watchedSeconds: progress.watchedSeconds, completed: progress.completed },
      });
    }
    await transaction.youTubePlaylist.update({
      where: { id: playlistId },
      data: {
        currentVideoId: item.youtubeVideoId,
        currentPosition: item.position,
        currentSeconds: progress.currentSeconds,
        status: 'ACTIVE',
      },
    });
  });
  revalidatePath('/youtube');
  revalidatePath(`/youtube/${playlistId}`);
}

export async function generateYouTubeArtworkPrompt(playlistId: string): Promise<YouTubeActionState> {
  try {
    const playlist = await prisma.youTubePlaylist.findUnique({
      where: { id: playlistId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!playlist) return { ok: false, error: 'Playlist not found.' };
    const imagePrompt = buildYouTubeImagePrompt({
      title: playlist.title,
      description: playlist.description,
      lectureTitles: playlist.items.map((item) => item.title),
    });
    await prisma.youTubePlaylist.update({ where: { id: playlistId }, data: { imagePrompt } });
    revalidatePath(`/youtube/${playlistId}`);
    return { ok: true, message: 'Image prompt generated.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function validRemoteImageUrl(input: string) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function updateYouTubeArtwork(
  playlistId: string,
  _previousState: YouTubeActionState,
  formData: FormData,
): Promise<YouTubeActionState> {
  try {
    const playlist = await prisma.youTubePlaylist.findUnique({ where: { id: playlistId } });
    if (!playlist) return { ok: false, error: 'Playlist not found.' };

    const file = formData.get('imageFile');
    const imageUrlInput = String(formData.get('imageUrl') ?? '').trim();
    let customImageUrl = validRemoteImageUrl(imageUrlInput);
    if (imageUrlInput && !customImageUrl) return { ok: false, error: 'Use a valid http:// or https:// image URL.' };

    if (file instanceof File && file.size > 0) {
      const extension = IMAGE_EXTENSIONS[file.type];
      if (!extension) return { ok: false, error: 'Upload a PNG, JPEG, WebP, or GIF image.' };
      if (file.size > MAX_ARTWORK_BYTES) return { ok: false, error: 'The image must be smaller than 8 MB.' };
      const uploadDirectory = path.join(process.cwd(), 'public', 'uploads', 'youtube-playlists');
      await mkdir(uploadDirectory, { recursive: true });
      const filename = `${playlist.youtubePlaylistId}-${randomUUID()}.${extension}`;
      await writeFile(path.join(uploadDirectory, filename), Buffer.from(await file.arrayBuffer()));
      customImageUrl = `/uploads/youtube-playlists/${filename}`;
    }

    if (!customImageUrl) return { ok: false, error: 'Choose an image file or paste an image URL.' };
    await prisma.youTubePlaylist.update({ where: { id: playlistId }, data: { customImageUrl } });
    revalidatePath('/youtube');
    revalidatePath(`/youtube/${playlistId}`);
    return { ok: true, message: 'Playlist artwork updated.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteYouTubePlaylist(playlistId: string) {
  await prisma.youTubePlaylist.delete({ where: { id: playlistId } });
  revalidatePath('/youtube');
  revalidatePath('/skills');
  redirect('/youtube');
}
