import { prisma } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

const MODES = [
  'Balanced', 'Japanese-focused', 'Chinese-focused', 'Math-focused', 'Books-focused',
  'Random-skills-focused', 'Review-heavy', 'New-content-heavy', 'Exam-cram', 'Mistake-cleanup',
];

export default async function DailyPage() {
  const [dueReviews, newItems, openMistakes, rememberNotes] = await Promise.all([
    prisma.reviewRecord.count({ where: { dueAt: { lte: new Date() }, isSuspended: false } }),
    prisma.learningItem.count({ where: { flashcards: { none: {} } } }),
    prisma.mistake.count({ where: { resolved: false } }),
    prisma.bookNote.count({ where: { remember: true, flashcards: { none: {} } } }),
  ]);

  return (
    <>
      <PageHeader title="Daily Study" subtitle="One queue combining reviews, new items, weak topics, and goals" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Due reviews" value={dueReviews} />
        <StatCard label="Items without cards" value={newItems} hint="candidates for new study" />
        <StatCard label="Open mistakes" value={openMistakes} />
        <StatCard label="Book notes to convert" value={rememberNotes} hint='marked "remember"' />
      </div>

      <Section title="Study mode">
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m, i) => (
            <span key={m} className={`rounded-md border px-2.5 py-1 text-[12px] ${i === 0 ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-2 text-muted'}`}>
              {m}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Today's queue">
        <EmptyState>
          Queue generation ships in <Badge tone="amber">Phase 2</Badge> together with the spaced-repetition
          scheduler. The queue will combine due reviews, new items by mode weighting, weak topics, and
          exam-prep priorities.
        </EmptyState>
      </Section>

      <Section title="How the queue will be built">
        <Card className="text-[12px] text-muted leading-relaxed">
          <ol className="ml-4 list-decimal space-y-1">
            <li>All due reviews (capped by daily review limit), ordered by overdue-ness.</li>
            <li>New flashcards from learning items, weighted by the selected mode.</li>
            <li>Mistake-review items for unresolved mistakes in weak areas.</li>
            <li>Exam-objective practice when a goal has a target date approaching.</li>
            <li>Book "remember" notes surfaced for flashcard conversion.</li>
          </ol>
        </Card>
      </Section>
    </>
  );
}
