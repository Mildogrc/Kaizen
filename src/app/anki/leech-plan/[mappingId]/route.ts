import { prisma } from '@/lib/db';
import { leeches } from '@/lib/anki-analytics';
import { ankiRowsForMappings } from '@/lib/anki-data';
import { buildLeechLessonPlanMd } from '@/lib/leech-prompt';

export async function GET(req: Request, { params }: { params: Promise<{ mappingId: string }> }) {
  const { mappingId } = await params;
  const mapping = await prisma.ankiDeckMapping.findUnique({
    where: { id: mappingId },
    include: { course: true },
  });
  if (!mapping) return new Response('Deck mapping not found', { status: 404 });

  // ?limit=N caps how many leeches (worst first) go into the plan.
  const limitParam = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : Infinity;

  const { snapshots } = await ankiRowsForMappings([mapping.id]);
  const md = buildLeechLessonPlanMd({
    deckName: mapping.deckName,
    courseName: mapping.course.name,
    leeches: leeches(snapshots).slice(0, limit),
  });
  const filename = `${mapping.deckName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-leech-lesson-plan.md`;
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
