export interface YouTubePlaylistVideo {
  videoId: string;
  position: number;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
}

export interface YouTubePlaylistMetadata {
  playlistId: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  totalItems: number;
  source: 'youtube-api' | 'youtube-page';
  items: YouTubePlaylistVideo[];
}

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function parseYouTubeDuration(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return parseYouTubeDuration(Number(text));
  if (/^\d+(?::[0-5]\d){1,2}$/.test(text)) {
    return parseYouTubeDuration(text.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0));
  }
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!iso) return null;
  return parseYouTubeDuration(Number(iso[1] ?? 0) * 86400 + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0));
}

export function youtubePlaylistRuntime(items: { durationSeconds: number | null }[], totalItems = items.length) {
  const known = items.filter((item) => item.durationSeconds != null && item.durationSeconds > 0);
  const seconds = known.reduce((sum, item) => sum + item.durationSeconds!, 0);
  const missing = Math.max(totalItems, items.length) - known.length;
  if (known.length === 0) return { label: 'Unavailable', hint: 'Refresh lectures to look up video lengths.' };
  const minutes = Math.round(seconds / 60);
  const formatted = minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : minutes > 0 ? `${minutes}m` : `${seconds}s`;
  return {
    label: `${formatted}${missing > 0 ? '+' : ''}`,
    hint: missing > 0 ? `${missing} ${missing === 1 ? 'video has' : 'videos have'} no duration available; shown time is a minimum.` : 'At normal playback speed',
  };
}

export function parseYouTubePlaylistId(input: string) {
  const value = input.trim();
  if (PLAYLIST_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Paste a valid YouTube playlist URL.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com' && hostname !== 'music.youtube.com' && hostname !== 'youtu.be') {
    throw new Error('The URL must be from YouTube.');
  }
  const playlistId = url.searchParams.get('list')?.trim() ?? '';
  if (!PLAYLIST_ID.test(playlistId)) {
    throw new Error('That URL does not contain a valid YouTube playlist ID.');
  }
  return playlistId;
}

function bestThumbnail(thumbnails: unknown): string | null {
  if (!thumbnails || typeof thumbnails !== 'object') return null;
  const values = Object.values(thumbnails as Record<string, unknown>)
    .filter((value): value is { url: string; width?: number } => Boolean(value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'))
    .sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
  return values[0]?.url ?? null;
}

function parseDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchFromYouTubeApi(playlistId: string, apiKey: string): Promise<YouTubePlaylistMetadata> {
  const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlists');
  playlistUrl.search = new URLSearchParams({ part: 'snippet,contentDetails', id: playlistId, key: apiKey }).toString();
  const playlistResponse = await fetch(playlistUrl, { cache: 'no-store' });
  if (!playlistResponse.ok) {
    throw new Error(`YouTube metadata request failed (${playlistResponse.status}).`);
  }
  const playlistPayload = await playlistResponse.json() as {
    items?: Array<{
      snippet?: { title?: string; description?: string; channelTitle?: string; thumbnails?: unknown };
      contentDetails?: { itemCount?: number };
    }>;
  };
  const playlist = playlistPayload.items?.[0];
  if (!playlist?.snippet?.title) throw new Error('YouTube could not find that public playlist.');

  const items: YouTubePlaylistVideo[] = [];
  let pageToken: string | undefined;
  do {
    const itemsUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    itemsUrl.search = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await fetch(itemsUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`YouTube lecture request failed (${response.status}).`);
    const payload = await response.json() as {
      nextPageToken?: string;
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
          position?: number;
          thumbnails?: unknown;
          publishedAt?: string;
          resourceId?: { videoId?: string };
        };
        contentDetails?: { videoId?: string; videoPublishedAt?: string };
      }>;
    };
    for (const item of payload.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId ?? '';
      const title = item.snippet?.title?.trim() ?? '';
      if (!VIDEO_ID.test(videoId) || !title || title === 'Deleted video' || title === 'Private video') continue;
      items.push({
        videoId,
        position: item.snippet?.position ?? items.length,
        title,
        description: item.snippet?.description?.trim() || null,
        thumbnailUrl: bestThumbnail(item.snippet?.thumbnails),
        publishedAt: parseDate(item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt),
        durationSeconds: null,
      });
    }
    pageToken = payload.nextPageToken;
  } while (pageToken);

  const videoIds = [...new Set(items.map((item) => item.videoId))];
  const durations = new Map<string, number | null>();
  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.search = new URLSearchParams({ part: 'contentDetails', id: videoIds.slice(offset, offset + 50).join(','), key: apiKey }).toString();
    const response = await fetch(videosUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`YouTube duration request failed (${response.status}). Please retry.`);
    const payload = await response.json() as { items?: Array<{ id: string; contentDetails?: { duration?: string } }> };
    for (const video of payload.items ?? []) durations.set(video.id, parseYouTubeDuration(video.contentDetails?.duration));
  }
  for (const item of items) item.durationSeconds = durations.get(item.videoId) ?? null;

  return {
    playlistId,
    sourceUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    title: playlist.snippet.title.trim(),
    description: playlist.snippet.description?.trim() || null,
    channelTitle: playlist.snippet.channelTitle?.trim() || null,
    thumbnailUrl: bestThumbnail(playlist.snippet.thumbnails) ?? items[0]?.thumbnailUrl ?? null,
    totalItems: playlist.contentDetails?.itemCount ?? items.length,
    source: 'youtube-api',
    items,
  };
}

function extractJsonObject(source: string, marker: string): unknown {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function textValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  if (typeof record.simpleText === 'string') return record.simpleText;
  return record.runs?.map((run) => typeof run.text === 'string' ? run.text : '').join('') ?? '';
}

function findRenderers(root: unknown, key: string) {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const renderer = record[key];
    if (renderer && typeof renderer === 'object' && !Array.isArray(renderer)) found.push(renderer as Record<string, unknown>);
    Object.values(record).forEach(visit);
  };
  visit(root);
  return found;
}

function thumbnailFromRenderer(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { thumbnails?: unknown; sources?: unknown };
  const thumbnails = record.thumbnails ?? record.sources;
  if (!Array.isArray(thumbnails)) return bestThumbnail(thumbnails);
  const sorted = thumbnails
    .filter((thumbnail): thumbnail is { url: string; width?: number } => Boolean(thumbnail && typeof thumbnail === 'object' && typeof thumbnail.url === 'string'))
    .sort((left, right) => (right.width ?? 0) - (left.width ?? 0));
  return sorted[0]?.url ?? null;
}

function parsePlaylistVideos(data: unknown, playlistId: string): YouTubePlaylistVideo[] {
  const videoRenderers = findRenderers(data, 'playlistVideoRenderer');
  const classicItems = videoRenderers.flatMap((renderer, fallbackPosition) => {
    const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : '';
    const title = textValue(renderer.title).trim();
    if (!VIDEO_ID.test(videoId) || !title || title === 'Deleted video' || title === 'Private video') return [];
    const index = Number.parseInt(textValue(renderer.index), 10);
    return [{
      videoId,
      position: Number.isFinite(index) ? Math.max(0, index - 1) : fallbackPosition,
      title,
      description: null,
      thumbnailUrl: thumbnailFromRenderer(renderer.thumbnail),
      publishedAt: null,
      durationSeconds: parseYouTubeDuration(renderer.lengthSeconds) ?? parseYouTubeDuration(textValue(renderer.lengthText)),
    } satisfies YouTubePlaylistVideo];
  });
  const modernItems = findRenderers(data, 'lockupViewModel').flatMap((renderer, fallbackPosition) => {
    const contentId = typeof renderer.contentId === 'string' ? renderer.contentId : '';
    if (renderer.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !VIDEO_ID.test(contentId)) return [];
    const metadata = renderer.metadata as { lockupMetadataViewModel?: { title?: { content?: unknown } } } | undefined;
    const titleValue = metadata?.lockupMetadataViewModel?.title?.content;
    const title = typeof titleValue === 'string' ? titleValue.trim() : '';
    if (!title || title === 'Deleted video' || title === 'Private video') return [];
    const context = renderer.rendererContext as {
      commandContext?: { onTap?: { innertubeCommand?: { watchEndpoint?: { index?: unknown; playlistId?: string } } } };
    } | undefined;
    const endpoint = context?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
    if (endpoint?.playlistId !== playlistId) return [];
    const endpointPosition = endpoint.index;
    const image = renderer.contentImage as { thumbnailViewModel?: { image?: unknown } } | undefined;
    return [{
      videoId: contentId,
      position: typeof endpointPosition === 'number' ? endpointPosition : fallbackPosition,
      title,
      description: null,
      thumbnailUrl: thumbnailFromRenderer(image?.thumbnailViewModel?.image),
      publishedAt: null,
      durationSeconds: findRenderers(renderer.contentImage, 'thumbnailBadgeViewModel')
        .map((badge) => parseYouTubeDuration(badge.text)).find((duration) => duration != null) ?? null,
    } satisfies YouTubePlaylistVideo];
  });
  const deduplicatedItems = new Map<string, YouTubePlaylistVideo>();
  for (const item of [...classicItems, ...modernItems]) {
    deduplicatedItems.set(`${item.position}:${item.videoId}`, item);
  }
  return [...deduplicatedItems.values()].sort((left, right) => left.position - right.position);
}

function playlistContinuation(data: unknown, playlistId: string): string | null {
  const containers = [
    ...findRenderers(data, 'playlistVideoListRenderer'),
    ...findRenderers(data, 'itemSectionRenderer'),
    ...findRenderers(data, 'appendContinuationItemsAction'),
    ...findRenderers(data, 'reloadContinuationItemsCommand'),
  ];
  const container = containers.find((candidate) => parsePlaylistVideos(candidate, playlistId).length > 0);
  if (!container) return null;
  const command = findRenderers(container, 'continuationCommand').find((candidate) => typeof candidate.token === 'string');
  return typeof command?.token === 'string' ? command.token : null;
}

export function parseYouTubePlaylistPage(html: string, playlistId: string): YouTubePlaylistMetadata {
  const initialData = extractJsonObject(html, 'ytInitialData');
  if (!initialData) throw new Error('YouTube did not return readable playlist details. Add YOUTUBE_API_KEY for reliable imports.');
  const metadataRenderer = findRenderers(initialData, 'playlistMetadataRenderer')[0];
  const items = parsePlaylistVideos(initialData, playlistId);
  const title = typeof metadataRenderer?.title === 'string' ? metadataRenderer.title.trim() : '';
  const description = typeof metadataRenderer?.description === 'string' ? metadataRenderer.description.trim() : '';
  const sidebarThumbnail = findRenderers(initialData, 'playlistVideoThumbnailRenderer')
    .map((renderer) => thumbnailFromRenderer(renderer.thumbnail))
    .find(Boolean) ?? null;
  const ownerRenderer = findRenderers(initialData, 'videoOwnerRenderer')[0];
  if (!title && items.length === 0) throw new Error('YouTube could not find a public playlist at that URL.');

  return {
    playlistId,
    sourceUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    title: title || 'YouTube playlist',
    description: description || null,
    channelTitle: textValue(ownerRenderer?.title).trim() || null,
    thumbnailUrl: sidebarThumbnail ?? items[0]?.thumbnailUrl ?? null,
    totalItems: items.length,
    source: 'youtube-page',
    items,
  };
}

async function fetchFromYouTubePage(playlistId: string) {
  const sourceUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`;
  const response = await fetch(sourceUrl, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kaizen/1.0)' },
  });
  if (!response.ok) throw new Error(`YouTube playlist request failed (${response.status}).`);
  const html = await response.text();
  const metadata = parseYouTubePlaylistPage(html, playlistId);
  let continuation = playlistContinuation(extractJsonObject(html, 'ytInitialData'), playlistId);
  const context = extractJsonObject(html, '"INNERTUBE_CONTEXT":') as {
    client?: { clientName?: string; clientVersion?: string };
  } | null;
  const seenTokens = new Set<string>();
  const itemsByPosition = new Map(metadata.items.map((item) => [item.position, item]));

  while (continuation) {
    if (!context?.client?.clientName || !context.client.clientVersion) {
      throw new Error('YouTube returned an incomplete playlist. Add YOUTUBE_API_KEY and retry to retrieve all lectures.');
    }
    if (seenTokens.has(continuation) || seenTokens.size >= 500) {
      throw new Error('YouTube did not finish listing this playlist. Please retry the import.');
    }
    seenTokens.add(continuation);
    const nextResponse = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: context.client.clientName, clientVersion: context.client.clientVersion, hl: 'en' } },
        continuation,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!nextResponse.ok) throw new Error(`YouTube could not load all lectures (${nextResponse.status}). Please retry.`);
    const nextData: unknown = await nextResponse.json();
    const nextItems = parsePlaylistVideos(nextData, playlistId);
    if (nextItems.length === 0) throw new Error('YouTube returned an unreadable lecture page. Please retry or configure YOUTUBE_API_KEY.');
    for (const item of nextItems) itemsByPosition.set(item.position, item);
    continuation = playlistContinuation(nextData, playlistId);
  }

  metadata.items = [...itemsByPosition.values()].sort((left, right) => left.position - right.position);
  metadata.totalItems = metadata.items.length;
  return metadata;
}

export async function fetchYouTubePlaylistMetadata(input: string) {
  const playlistId = parseYouTubePlaylistId(input);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  return apiKey ? fetchFromYouTubeApi(playlistId, apiKey) : fetchFromYouTubePage(playlistId);
}

export function buildYouTubeEmbedUrl(input: { playlistId: string; videoId?: string | null; position?: number; seconds?: number }) {
  const query = new URLSearchParams({
    list: input.playlistId,
    enablejsapi: '1',
    playsinline: '1',
    rel: '0',
  });
  if (input.position != null) query.set('index', String(Math.max(0, Math.floor(input.position))));
  if (input.seconds && input.seconds > 0) query.set('start', String(Math.max(0, Math.floor(input.seconds))));
  return input.videoId && VIDEO_ID.test(input.videoId)
    ? `https://www.youtube.com/embed/${input.videoId}?${query.toString()}`
    : `https://www.youtube.com/embed/videoseries?${query.toString()}`;
}

export function buildYouTubeImagePrompt(input: { title: string; description?: string | null; lectureTitles: string[] }) {
  const lectures = input.lectureTitles.length > 0
    ? input.lectureTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')
    : 'No lecture titles were available.';
  return [
    'Create a polished 16:9 cover illustration for a learning playlist.',
    'Use the subject matter and progression of the lectures to choose the visual concept.',
    'Make it readable as a small dashboard card: one clear focal point, strong contrast, no logos, no UI chrome, and no written text in the image.',
    '',
    `Playlist: ${input.title}`,
    `Description: ${input.description?.trim() || 'No description provided.'}`,
    '',
    'Lecture sequence:',
    lectures,
  ].join('\n');
}
