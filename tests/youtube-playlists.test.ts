import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildYouTubeEmbedUrl,
  buildYouTubeImagePrompt,
  fetchYouTubePlaylistMetadata,
  parseYouTubeDuration,
  parseYouTubePlaylistId,
  parseYouTubePlaylistPage,
  youtubePlaylistRuntime,
} from '../src/lib/youtube-playlists';

describe('YouTube playlists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('extracts playlist IDs from common YouTube URLs', () => {
    expect(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=PL1234567890abcdef')).toBe('PL1234567890abcdef');
    expect(parseYouTubePlaylistId('https://www.youtube.com/watch?v=abc123def45&list=PL1234567890abcdef')).toBe('PL1234567890abcdef');
    expect(parseYouTubePlaylistId('PL1234567890abcdef')).toBe('PL1234567890abcdef');
  });

  it('rejects non-YouTube URLs and URLs without a playlist', () => {
    expect(() => parseYouTubePlaylistId('https://example.com/playlist?list=PL1234567890abcdef')).toThrow('YouTube');
    expect(() => parseYouTubePlaylistId('https://www.youtube.com/watch?v=abc123def45')).toThrow('playlist ID');
  });

  it('parses playlist page metadata and lecture order', () => {
    const initialData = {
      metadata: { playlistMetadataRenderer: { title: 'A Course', description: 'Course description' } },
      sidebar: {
        playlistSidebarPrimaryInfoRenderer: {
          thumbnailRenderer: { playlistVideoThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://img.example/cover.jpg', width: 640 }] } } },
        },
        playlistSidebarSecondaryInfoRenderer: { videoOwner: { videoOwnerRenderer: { title: { runs: [{ text: 'Teacher' }] } } } },
      },
      contents: [
        { playlistVideoRenderer: { videoId: 'abcdefghijk', index: { simpleText: '1' }, title: { runs: [{ text: 'Lecture One' }] }, lengthSeconds: '3601', thumbnail: { thumbnails: [{ url: 'https://img.example/1.jpg' }] } } },
        { playlistVideoRenderer: { videoId: 'lmnopqrstuv', index: { simpleText: '2' }, title: { simpleText: 'Lecture Two' }, lengthText: { simpleText: '45:12' }, thumbnail: { thumbnails: [{ url: 'https://img.example/2.jpg' }] } } },
      ],
    };
    const html = `<html><script>var ytInitialData = ${JSON.stringify(initialData)};</script></html>`;
    const parsed = parseYouTubePlaylistPage(html, 'PL1234567890abcdef');
    expect(parsed).toMatchObject({ title: 'A Course', description: 'Course description', channelTitle: 'Teacher', totalItems: 2 });
    expect(parsed.items.map((item) => [item.position, item.title])).toEqual([[0, 'Lecture One'], [1, 'Lecture Two']]);
    expect(parsed.items.map((item) => item.durationSeconds)).toEqual([3601, 2712]);
  });

  it('parses the newer lockup view-model playlist rows', () => {
    const initialData = {
      metadata: { playlistMetadataRenderer: { title: 'Modern Course', description: 'New page shape' } },
      contents: [{
        lockupViewModel: {
          contentId: 'abcdefghijk',
          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
          contentImage: { thumbnailViewModel: {
            image: { sources: [{ url: 'https://img.example/1.jpg', width: 336 }] },
            overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '1:05:09' } }] } }],
          } },
          metadata: { lockupMetadataViewModel: { title: { content: 'Modern Lecture' } } },
          rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { index: 4, playlistId: 'PL1234567890abcdef' } } } } },
        },
      }],
    };
    const html = `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`;
    const parsed = parseYouTubePlaylistPage(html, 'PL1234567890abcdef');
    expect(parsed.items).toEqual([expect.objectContaining({
      videoId: 'abcdefghijk',
      position: 4,
      title: 'Modern Lecture',
      thumbnailUrl: 'https://img.example/1.jpg',
      durationSeconds: 3909,
    })]);
  });

  it('imports continuation pages without following recommendation pagination', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');
    const video = (position: number) => ({ playlistVideoRenderer: {
      videoId: `video${String(position).padStart(6, '0')}`,
      title: { simpleText: `Lecture ${position + 1}` },
      index: { simpleText: String(position + 1) },
      lengthSeconds: String((position + 1) * 60),
    } });
    const continuation = (token: string) => ({ continuationItemViewModel: {
      continuationCommand: { innertubeCommand: { continuationCommand: { token } } },
    } });
    const data = {
      metadata: { playlistMetadataRenderer: { title: 'Long course' } },
      contents: [{ itemSectionRenderer: { contents: [video(0), continuation('lecture-page-2')] } }, continuation('recommendations')],
    };
    const html = `<script>ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"test-version"}}});</script><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(html))
      .mockResolvedValueOnce(Response.json({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [video(1)] } }] }));
    vi.stubGlobal('fetch', mockedFetch);

    const result = await fetchYouTubePlaylistMetadata('PL1234567890abcdef');
    expect(result.items.map((item) => item.title)).toEqual(['Lecture 1', 'Lecture 2']);
    expect(result.totalItems).toBe(2);
    expect(result.items.map((item) => item.durationSeconds)).toEqual([60, 120]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockedFetch.mock.calls[1][1].body).continuation).toBe('lecture-page-2');
  });

  it('fails instead of silently importing a partial playlist when pagination fails', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '');
    const data = {
      metadata: { playlistMetadataRenderer: { title: 'Long course' } },
      contents: { playlistVideoListRenderer: { contents: [
        { playlistVideoRenderer: { videoId: 'abcdefghijk', title: { simpleText: 'Lecture 1' }, index: { simpleText: '1' } } },
        { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } },
      ] } },
    };
    const html = `<script>ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"test-version"}}});</script><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response('', { status: 503 })));
    await expect(fetchYouTubePlaylistMetadata('PL1234567890abcdef')).rejects.toThrow('could not load all lectures');
  });

  it('builds a resumable embedded playlist URL', () => {
    const url = new URL(buildYouTubeEmbedUrl({ playlistId: 'PL1234567890abcdef', videoId: 'abcdefghijk', position: 3, seconds: 92 }));
    expect(url.pathname).toBe('/embed/abcdefghijk');
    expect(url.searchParams.get('list')).toBe('PL1234567890abcdef');
    expect(url.searchParams.get('index')).toBe('3');
    expect(url.searchParams.get('start')).toBe('92');
  });

  it('reads ISO durations and leaves live or malformed lengths unknown', () => {
    expect(parseYouTubeDuration('PT1H2M3S')).toBe(3723);
    expect(parseYouTubeDuration('P1DT2H')).toBe(93600);
    expect(parseYouTubeDuration('LIVE')).toBeNull();
    expect(parseYouTubeDuration('12:99')).toBeNull();
    expect(parseYouTubeDuration('PT0S')).toBeNull();
  });

  it('distinguishes a complete runtime from a partial or missing runtime', () => {
    expect(youtubePlaylistRuntime([{ durationSeconds: 3600 }, { durationSeconds: 1800 }]).label).toBe('1h 30m');
    expect(youtubePlaylistRuntime([{ durationSeconds: 3600 }, { durationSeconds: null }])).toMatchObject({ label: '1h 0m+', hint: expect.stringContaining('minimum') });
    expect(youtubePlaylistRuntime([{ durationSeconds: 3600 }], 2).label).toBe('1h 0m+');
    expect(youtubePlaylistRuntime([{ durationSeconds: null }]).label).toBe('Unavailable');
  });

  it('fetches video durations through the API and matches them by video ID', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [{ snippet: { title: 'Course' }, contentDetails: { itemCount: 2 } }] }))
      .mockResolvedValueOnce(Response.json({ items: [
        { snippet: { title: 'First', position: 0 }, contentDetails: { videoId: 'abcdefghijk' } },
        { snippet: { title: 'Second', position: 1 }, contentDetails: { videoId: 'lmnopqrstuv' } },
      ] }))
      .mockResolvedValueOnce(Response.json({ items: [
        { id: 'lmnopqrstuv', contentDetails: { duration: 'PT20M' } },
        { id: 'abcdefghijk', contentDetails: { duration: 'PT1H2M3S' } },
      ] }));
    vi.stubGlobal('fetch', mockedFetch);
    const result = await fetchYouTubePlaylistMetadata('PL1234567890abcdef');
    expect(result.items.map((item) => item.durationSeconds)).toEqual([3723, 1200]);
    expect(mockedFetch.mock.calls[2][0].pathname).toBe('/youtube/v3/videos');
  });

  it('uses the description and every lecture title in the GPT image prompt', () => {
    const prompt = buildYouTubeImagePrompt({
      title: 'Algebra',
      description: 'A complete introduction.',
      lectureTitles: ['Groups', 'Rings', 'Fields'],
    });
    expect(prompt).toContain('Playlist: Algebra');
    expect(prompt).toContain('Description: A complete introduction.');
    expect(prompt).toContain('1. Groups');
    expect(prompt).toContain('2. Rings');
    expect(prompt).toContain('3. Fields');
  });
});
