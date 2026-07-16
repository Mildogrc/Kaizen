import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildSchemaExport } from '@/lib/schema-serialize';
import { Badge, Card, PageHeader, Section, btnCls } from '@/components/ui';
import { CopyButton } from '@/components/copy-button';

export const dynamic = 'force-dynamic';

export default async function SchemaDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const schema = await prisma.contentSchema.findUnique({
    where: { slug },
    include: {
      course: true,
      versions: { orderBy: { version: 'desc' }, take: 1, include: { fields: { orderBy: { order: 'asc' } } } },
      _count: { select: { learningItems: true } },
    },
  });
  if (!schema || schema.versions.length === 0) notFound();
  const version = schema.versions[0];

  const exportDoc = buildSchemaExport({
    name: schema.name,
    slug: schema.slug,
    itemType: schema.itemType,
    category: schema.category,
    description: schema.description,
    version: version.version,
    config: version.config,
    fields: version.fields,
  });
  const exportJson = JSON.stringify(exportDoc, null, 2);
  const config = version.config as Record<string, unknown>;

  return (
    <>
      <div className="mb-1 text-[12px]">
        <Link href="/schemas" className="text-muted hover:text-foreground">← Schemas</Link>
      </div>
      <PageHeader
        title={schema.name}
        subtitle={schema.description ?? undefined}
        actions={
          <>
            <CopyButton text={exportJson} label="⧉ Copy schema JSON" />
            <Link href={`/import?schema=${schema.slug}`} className={btnCls}>⇥ Import against this schema</Link>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Badge tone="blue">v{version.version}</Badge>
        <span className="font-mono">{schema.itemType}</span>
        <span>· {schema.category.toLowerCase()}</span>
        {schema.course && <span>· course: {schema.course.name}</span>}
        <span>· {schema._count.learningItems} items stored</span>
      </div>

      <Section title={`Fields (${version.fields.length})`}>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Req</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Example</th>
                <th className="px-3 py-2">LLM instructions</th>
              </tr>
            </thead>
            <tbody>
              {version.fields.map((f) => (
                <tr key={f.id} className="border-b border-line/50 align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono font-medium">{f.name}</div>
                    <div className="text-muted">{f.label}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{f.fieldType.toLowerCase().replace('_', ' ')}</Badge>
                    {f.enumOptions != null && (
                      <div className="mt-1 max-w-44 text-[11px] text-muted">{(f.enumOptions as string[]).join(', ')}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{f.required ? <span className="text-amber-400">✓</span> : <span className="text-muted">–</span>}</td>
                  <td className="max-w-56 px-3 py-2 text-muted">{f.description}</td>
                  <td className="max-w-44 px-3 py-2 font-mono text-[11px] text-muted">
                    {f.exampleValue !== null ? JSON.stringify(f.exampleValue) : ''}
                  </td>
                  <td className="max-w-56 px-3 py-2 text-muted">{f.llmInstructions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      {(config.flashcardRules as unknown[] | undefined)?.length ? (
        <Section title="Flashcard generation rules">
          <div className="grid gap-2 md:grid-cols-2">
            {(config.flashcardRules as { name: string; front: string; back: string }[]).map((r) => (
              <Card key={r.name} className="p-3">
                <Badge tone="purple">{r.name}</Badge>
                <div className="mt-2 space-y-1 font-mono text-[12px]">
                  <div><span className="text-muted">front:</span> {r.front}</div>
                  <div><span className="text-muted">back:</span> {r.back}</div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Example item (valid JSON)">
        <Card className="p-0">
          <pre className="overflow-x-auto p-3 font-mono text-[12px] text-green-300/90">
            {JSON.stringify([exportDoc.exampleItem], null, 2)}
          </pre>
        </Card>
      </Section>

      <Section title="Schema export" actions={<CopyButton text={exportJson} label="⧉ Copy" />}>
        <Card className="p-0">
          <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] text-muted">{exportJson}</pre>
        </Card>
      </Section>
    </>
  );
}
