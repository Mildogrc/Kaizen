import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge, Card, PageHeader, Section, StatCard, btnCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

// Per-skill focus areas shown as chips; content itself is schema-driven.
const FOCUS: Record<string, string[]> = {
  typing: ['WPM', 'accuracy', 'weak keys', 'custom drills'],
  'nato-alphabet': ['letter → word', 'word → letter', 'timed recall', 'mistake tracking'],
  geoguessr: ['countries', 'flags', 'road signs', 'license plates', 'bollards', 'driving side', 'languages/scripts', 'map regions'],
};

export default async function SkillsPage() {
  const courses = await prisma.course.findMany({
    where: { tab: 'SKILLS' },
    include: {
      schemas: { include: { _count: { select: { learningItems: true } } } },
      goals: { where: { status: 'ACTIVE' } },
      _count: { select: { learningItems: true, flashcards: true, practiceItems: true } },
    },
    orderBy: { name: 'asc' },
  });

  const totalItems = courses.reduce((s, c) => s + c._count.learningItems, 0);

  return (
    <>
      <PageHeader
        title="Random Skills"
        subtitle="Typing, NATO alphabet, GeoGuessr — small skills, deliberately practiced"
        actions={<Link href="/import" className={btnCls}>⇥ Import content</Link>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Skills" value={courses.length} />
        <StatCard label="Learning items" value={totalItems} />
        <StatCard label="Practice items" value={courses.reduce((s, c) => s + c._count.practiceItems, 0)} />
      </div>

      <div className="space-y-4">
        {courses.map((course) => (
          <Section key={course.id} title={course.name}>
            <Card>
              <div className="mb-2 flex items-start justify-between gap-3">
                <p className="text-[12px] text-muted">{course.description}</p>
                <span className="shrink-0 text-[12px] text-muted tabular-nums">
                  {course._count.learningItems} items · {course._count.flashcards} cards
                </span>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(FOCUS[course.slug] ?? []).map((f) => (
                  <Badge key={f}>{f}</Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {course.schemas.map((s) => (
                  <Link key={s.id} href={`/schemas/${s.slug}`} className={btnCls}>
                    ⬡ {s.name} <span className="text-muted tabular-nums">({s._count.learningItems})</span>
                  </Link>
                ))}
                <Link href={`/import?course=${course.slug}`} className={btnCls}>⇥ Import</Link>
              </div>
              {course.goals.length > 0 && (
                <div className="mt-3 border-t border-line pt-2 text-[12px] text-muted">
                  Active goal: {course.goals.map((g) => g.title).join(' · ')}
                </div>
              )}
            </Card>
          </Section>
        ))}
      </div>
    </>
  );
}
