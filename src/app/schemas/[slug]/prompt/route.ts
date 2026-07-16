import { prisma } from '@/lib/db';
import { buildSchemaExport } from '@/lib/schema-serialize';
import { buildLlmPromptMd } from '@/lib/llm-prompt';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const schema = await prisma.contentSchema.findUnique({
    where: { slug },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { fields: { orderBy: { order: 'asc' } } } } },
  });
  if (!schema || schema.versions.length === 0) {
    return new Response('Schema not found', { status: 404 });
  }
  const version = schema.versions[0];
  const md = buildLlmPromptMd(
    buildSchemaExport({
      name: schema.name,
      slug: schema.slug,
      itemType: schema.itemType,
      category: schema.category,
      description: schema.description,
      version: version.version,
      config: version.config,
      fields: version.fields,
    }),
  );
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-import-prompt.md"`,
    },
  });
}
