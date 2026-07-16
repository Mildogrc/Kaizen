import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, statusTone, fmtStatus, btnCls } from '@/components/ui';

// Shared page body for the Japanese and Chinese tabs: goal → exam tracks →
// milestones → content databases → import/generate entry points.
export async function LanguageCoursePage({ slug }: { slug: string }) {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      goals: { orderBy: { createdAt: 'asc' } },
      milestones: { orderBy: { order: 'asc' } },
      exams: { include: { levels: { orderBy: { rank: 'asc' }, include: { objectives: true } } } },
      schemas: { include: { _count: { select: { learningItems: true } } } },
      importBatches: { orderBy: { createdAt: 'desc' }, take: 5 },
      _count: { select: { learningItems: true, flashcards: true, mistakes: true } },
    },
  });
  if (!course) return <EmptyState>Course not found. Re-run the seed.</EmptyState>;

  const dueReviews = await prisma.reviewRecord.count({
    where: {
      dueAt: { lte: new Date() },
      isSuspended: false,
      OR: [{ flashcard: { courseId: course.id } }, { practiceItem: { courseId: course.id } }],
    },
  });

  const activeGoals = course.goals.filter((g) => g.status === 'ACTIVE');
  const plannedGoals = course.goals.filter((g) => g.status === 'PLANNED');

  return (
    <>
      <PageHeader
        title={course.name}
        subtitle={course.description ?? undefined}
        actions={
          <>
            <Link href={`/import?course=${course.slug}`} className={btnCls}>⇥ Import content</Link>
            <Link href="/schemas" className={btnCls}>⬡ Schemas</Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Learning items" value={course._count.learningItems} accent={course.color ?? undefined} />
        <StatCard label="Flashcards" value={course._count.flashcards} />
        <StatCard label="Due reviews" value={dueReviews} />
        <StatCard label="Open mistakes" value={course._count.mistakes} />
      </div>

      <Section title="Current goal">
        {activeGoals.length === 0 ? (
          <EmptyState>No active goal. Pick a target below (e.g. an exam level) to build a plan around.</EmptyState>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeGoals.map((g) => (
              <Card key={g.id} className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{g.title}</span>
                  <Badge tone="blue">active</Badge>
                </div>
                {g.targetValue != null && (
                  <div className="mt-2">
                    <ProgressBar pct={(g.currentValue / g.targetValue) * 100} color={course.color ?? undefined} />
                    <div className="mt-1 text-[11px] text-muted tabular-nums">{g.currentValue} / {g.targetValue} {g.unit}</div>
                  </div>
                )}
                {g.description && <p className="mt-1.5 text-[12px] text-muted">{g.description}</p>}
              </Card>
            ))}
            {plannedGoals.map((g) => (
              <Card key={g.id} className="p-3 opacity-70">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{g.title}</span>
                  <Badge>planned</Badge>
                </div>
                {g.description && <p className="mt-1.5 text-[12px] text-muted">{g.description}</p>}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Exam tracks">
        <div className="space-y-3">
          {course.exams.map((exam) => (
            <Card key={exam.id} className="p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">{exam.name}</span>
                <span className="text-[11px] text-muted">{exam.description}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {exam.levels.map((level) => {
                  const targets = level.targets as Record<string, number>;
                  const hint = targets.targetVocab
                    ? `${targets.targetVocab.toLocaleString()}w`
                    : targets.targetKanji
                      ? `${targets.targetKanji.toLocaleString()}字`
                      : targets.targetChars
                        ? `${targets.targetChars.toLocaleString()}字`
                        : targets.targetScore != null
                          ? `${targets.targetScore}+`
                          : '';
                  return (
                    <div key={level.id} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-center">
                      <div className="text-[12px] font-medium">{level.name}</div>
                      {hint && <div className="text-[10px] text-muted tabular-nums">{hint}</div>}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Progression milestones">
        {course.milestones.length === 0 ? (
          <EmptyState>No milestones yet.</EmptyState>
        ) : (
          <Card className="p-0">
            <ol>
              {course.milestones.map((m, i) => (
                <li key={m.id} className={`flex items-center gap-3 px-4 py-2 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${m.completedAt ? 'bg-green-900 text-green-300' : 'bg-surface-2 text-muted'}`}>
                    {m.completedAt ? '✓' : m.order}
                  </span>
                  <span className="flex-1 text-[13px]">{m.title}</span>
                  {m.targetValue != null && (
                    <span className="text-[11px] text-muted tabular-nums">{m.targetValue.toLocaleString()} {m.metric}</span>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </Section>

      <Section title="Content databases">
        <div className="grid gap-2 md:grid-cols-2">
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
      </Section>

      <Section title="Recent imports">
        {course.importBatches.length === 0 ? (
          <EmptyState>
            Nothing imported yet. Export a schema, have an LLM generate items against it, then{' '}
            <Link href={`/import?course=${course.slug}`} className="text-accent underline">import the JSON</Link>.
          </EmptyState>
        ) : (
          <div className="space-y-1.5">
            {course.importBatches.map((b) => (
              <Card key={b.id} className="flex items-center justify-between p-2.5">
                <span className="text-[12px]">{b.sourceName ?? 'import'} · {b.createdAt.toISOString().slice(0, 10)}</span>
                <span className="flex items-center gap-2 text-[11px] text-muted">
                  <Badge tone={statusTone(b.status === 'COMPLETED' ? 'COMPLETED' : 'PAUSED')}>{fmtStatus(b.status)}</Badge>
                  {b.validCount}/{b.totalCount} valid
                </span>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
