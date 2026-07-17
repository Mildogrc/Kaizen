import { prisma } from '@/lib/db';
import { addMistake, bumpMistake, deleteMistake, toggleMistakeResolved } from '@/lib/actions';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MistakesPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course: courseFilter } = await searchParams;
  const [courses, mistakes] = await Promise.all([
    prisma.course.findMany({ orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true } }),
    prisma.mistake.findMany({
      include: { course: { select: { slug: true, name: true, color: true } } },
      orderBy: [{ resolved: 'asc' }, { updatedAt: 'desc' }],
    }),
  ]);

  const filtered = courseFilter ? mistakes.filter((m) => m.course.slug === courseFilter) : mistakes;
  const open = filtered.filter((m) => !m.resolved);
  const resolved = filtered.filter((m) => m.resolved);

  return (
    <>
      <PageHeader title="Mistakes" subtitle="Log what went wrong, revisit it deliberately, resolve it for good" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Open" value={open.length} accent="#f87171" />
        <StatCard label="Resolved" value={resolved.length} />
        <StatCard label="Repeat offenders" value={filtered.filter((m) => m.count > 1).length} hint="logged more than once" />
      </div>

      <Section title="Log a mistake">
        <Card>
          <form action={addMistake} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
            <input name="description" required placeholder="What went wrong? *" className={inputCls} />
            <select name="courseId" required defaultValue={courses.find((c) => c.slug === courseFilter)?.id ?? ''} className={inputCls}>
              <option value="" disabled>course *</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input name="category" placeholder="Category (e.g. tones, sign error)" className={inputCls} />
            <button type="submit" className={btnPrimaryCls}>Log</button>
          </form>
        </Card>
      </Section>

      <Section
        title={`Open (${open.length})`}
        actions={
          <span className="flex gap-1.5">
            <a href="/mistakes" className={`${btnCls} ${!courseFilter ? 'border-accent/60 text-accent' : ''}`}>all</a>
            {courses
              .filter((c) => mistakes.some((m) => m.course.slug === c.slug))
              .map((c) => (
                <a key={c.slug} href={`/mistakes?course=${c.slug}`} className={`${btnCls} ${courseFilter === c.slug ? 'border-accent/60 text-accent' : ''}`}>
                  {c.name}
                </a>
              ))}
          </span>
        }
      >
        {open.length === 0 ? (
          <EmptyState>No open mistakes{courseFilter ? ' for this course' : ''} — clean slate.</EmptyState>
        ) : (
          <div className="space-y-1.5">
            {open.map((m) => (
              <Card key={m.id} className="flex items-center gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">{m.description}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <Badge tone="blue">{m.course.name}</Badge>
                    {m.category && <span>{m.category}</span>}
                    {m.count > 1 && <span className="text-red-300">×{m.count}</span>}
                    <span>{m.updatedAt.toISOString().slice(0, 10)}</span>
                  </div>
                </div>
                <form action={bumpMistake.bind(null, m.id)}>
                  <button type="submit" className={btnCls} title="Happened again — bump the count">+1</button>
                </form>
                <form action={toggleMistakeResolved.bind(null, m.id)}>
                  <button type="submit" className={btnCls} title="Mark resolved">✓ Resolve</button>
                </form>
                <form action={deleteMistake.bind(null, m.id)}>
                  <button type="submit" className="px-1 text-[12px] text-muted hover:text-red-400 cursor-pointer" title="Delete">✕</button>
                </form>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {resolved.length > 0 && (
        <Section title={`Resolved (${resolved.length})`}>
          <div className="space-y-1.5">
            {resolved.map((m) => (
              <Card key={m.id} className="flex items-center gap-3 p-2.5 opacity-60">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] line-through">{m.description}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <Badge>{m.course.name}</Badge>
                    {m.category && <span>{m.category}</span>}
                  </div>
                </div>
                <form action={toggleMistakeResolved.bind(null, m.id)}>
                  <button type="submit" className={btnCls} title="Reopen">↩ Reopen</button>
                </form>
                <form action={deleteMistake.bind(null, m.id)}>
                  <button type="submit" className="px-1 text-[12px] text-muted hover:text-red-400 cursor-pointer" title="Delete">✕</button>
                </form>
              </Card>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
