import { prisma } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const courses = await prisma.course.findMany({
    include: { _count: { select: { learningItems: true, flashcards: true, practiceItems: true, mistakes: true } } },
    orderBy: { name: 'asc' },
  });
  const attempts = await prisma.attempt.count();

  return (
    <>
      <PageHeader title="Analytics" subtitle="Progress, load, and weakness analysis" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total learning items" value={courses.reduce((s, c) => s + c._count.learningItems, 0)} />
        <StatCard label="Total flashcards" value={courses.reduce((s, c) => s + c._count.flashcards, 0)} />
        <StatCard label="Review attempts" value={attempts} />
      </div>

      <Section title="Per-course inventory">
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-3 py-2">Course</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Cards</th>
                <th className="px-3 py-2 text-right">Practice</th>
                <th className="px-3 py-2 text-right">Mistakes</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id} className="border-b border-line/50">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c._count.learningItems}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c._count.flashcards}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c._count.practiceItems}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c._count.mistakes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Trends & weakness analysis">
        <EmptyState>
          Retention curves, weak-area detection, and streak charts ship in <Badge tone="amber">Phase 3</Badge>,
          once review history accumulates.
        </EmptyState>
      </Section>
    </>
  );
}
