import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge, Card, PageHeader, Section, btnPrimaryCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

const CATEGORY_ORDER = ['LANGUAGE', 'MATH', 'SKILL', 'BOOK', 'CERTIFICATION', 'CUSTOM'];

export default async function SchemasPage() {
  const schemas = await prisma.contentSchema.findMany({
    include: {
      course: true,
      versions: { orderBy: { version: 'desc' }, take: 1, include: { _count: { select: { fields: true } } } },
      _count: { select: { learningItems: true } },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <PageHeader
        title="Schema Designer"
        subtitle="Every content type is a schema. Add a new course by defining what its content looks like."
        actions={<Link href="/schemas/new" className={btnPrimaryCls}>+ New course / schema</Link>}
      />

      {CATEGORY_ORDER.map((cat) => {
        const group = schemas.filter((s) => s.category === cat);
        if (group.length === 0) return null;
        return (
          <Section key={cat} title={cat.toLowerCase()}>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {group.map((s) => (
                <Link key={s.id} href={`/schemas/${s.slug}`}>
                  <Card className="p-3 hover:border-accent/40 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{s.name}</span>
                      <Badge tone="blue">v{s.versions[0]?.version ?? 1}</Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted">{s.itemType}</div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted tabular-nums">
                      <span>{s.versions[0]?._count.fields ?? 0} fields</span>
                      <span>{s._count.learningItems} items</span>
                      {s.course && <span className="ml-auto">{s.course.name}</span>}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}
