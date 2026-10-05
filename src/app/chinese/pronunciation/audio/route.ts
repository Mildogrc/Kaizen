import { retrieveMediaFile } from '@/lib/anki-connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

export async function GET(request: Request) {
  const filename = new URL(request.url).searchParams.get('file') ?? '';
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!/^[a-zA-Z0-9_.-]{1,255}$/u.test(filename) || filename.includes('..') || !AUDIO_TYPES[extension]) {
    return new Response('Invalid audio filename.', { status: 400 });
  }

  try {
    const encoded = await retrieveMediaFile(filename);
    if (!encoded) return new Response('Word audio was not found in Anki.', { status: 404 });
    return new Response(Buffer.from(encoded, 'base64'), {
      headers: {
        'Cache-Control': 'private, max-age=2592000',
        'Content-Type': AUDIO_TYPES[extension],
      },
    });
  } catch {
    return new Response('Anki is not available.', { status: 503 });
  }
}
