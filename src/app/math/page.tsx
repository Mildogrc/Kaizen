import Link from 'next/link';
import { prisma } from '@/lib/db';
import { configuredMathTargetSlug } from '@/lib/math-goals';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnCls } from '@/components/ui';
import { GenerateButton } from '@/components/generate-button';
import { MathRoadmap } from './roadmap-view';

export const dynamic = 'force-dynamic';

export default async function MathPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target } = await searchParams;
  const course = await prisma.course.findUnique({
    where: { slug: 'math' },
    include: {
      goals: { where: { status: 'ACTIVE' } },
      schemas: { include: { _count: { select: { learningItems: true } } } },
      _count: { select: { learningItems: true, practiceItems: true, mistakes: true } },
    },
  });
  const roadmap = await prisma.roadmap.findUnique({
    where: { slug: 'math-roadmap' },
    include: { nodes: { orderBy: { order: 'asc' } }, edges: true },
  });
  if (!course || !roadmap) return <EmptyState>Math course not found. Re-run the seed.</EmptyState>;

  const done = roadmap.nodes.filter((n) => n.status === 'COMPLETED').length;
  const inProgress = roadmap.nodes.filter((n) => n.status === 'IN_PROGRESS').length;
  const mathTargets = roadmap.nodes.filter((node) => node.isTarget);
  const currentTargetSlug = configuredMathTargetSlug(course.metadata, mathTargets, course.goals[0]?.title);
  const currentTarget = mathTargets.find((node) => node.slug === currentTargetSlug) ?? null;

  return (
    <>
      <PageHeader
        title="Mathematics"
        subtitle={course.description ?? undefined}
        actions={
          <>
            <GenerateButton courseId={course.id} />
            <Link href="/import?course=math" className={btnCls}>⇥ Import content</Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Courses completed" value={done} hint={`of ${roadmap.nodes.length} roadmap nodes`} accent="#2563eb" />
        <StatCard label="In progress" value={inProgress} />
        <StatCard label="Learning items" value={course._count.learningItems} hint="definitions, theorems, exercises" />
        <StatCard label="Open mistakes" value={course._count.mistakes} />
      </div>

      {currentTarget && (
        <Section title="Current goal">
          <Card className="flex items-center justify-between gap-3 p-2.5">
            <div className="flex items-center gap-2"><Badge tone="blue">goal</Badge><span className="text-[13px]">Path to {currentTarget.title}</span></div>
            <Link href="/configurations?section=math" className="text-[12px] text-accent hover:underline">Change goal →</Link>
          </Card>
        </Section>
      )}

      <Section title="Roadmap">
        <MathRoadmap
          nodes={roadmap.nodes.map((n) => ({
            id: n.id, slug: n.slug, title: n.title, status: n.status,
            branch: n.branch, level: n.level, isTarget: n.isTarget, description: n.description,
          }))}
          edges={roadmap.edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, kind: e.kind }))}
          initialTarget={target ?? currentTargetSlug}
        />
      </Section>

      <details className="mb-6 rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Content databases <span className="text-muted">({course.schemas.length})</span></summary>
        <div className="grid gap-2 border-t border-line p-4 md:grid-cols-2">
          {course.schemas.map((s) => (
            <Link key={s.id} href={`/schemas/${s.slug}`}>
              <Card className="flex items-center justify-between p-3 hover:border-accent/40 transition-colors">
                <div>
                  <div className="text-[13px] font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted">{s.itemType}</div>
                </div>
                <span className="text-lg font-semibold tabular-nums text-muted">{s._count.learningItems}</span>
              </Card>
            </Link>
          ))}
        </div>
      </details>
    </>
  );
}
