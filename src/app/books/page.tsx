import Link from 'next/link';
import { prisma } from '@/lib/db';
import { createBook } from '@/lib/actions';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnPrimaryCls, inputCls, statusTone, fmtStatus } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_ORDER = ['READING', 'WANT_TO_READ', 'PAUSED', 'FINISHED', 'ABANDONED'] as const;
const STATUS_LABEL: Record<string, string> = {
  READING: 'Currently reading',
  WANT_TO_READ: 'Want to read',
  PAUSED: 'Paused',
  FINISHED: 'Finished',
  ABANDONED: 'Abandoned',
};

export default async function BooksPage() {
  const books = await prisma.book.findMany({
    include: { _count: { select: { notes: true } }, notes: { where: { remember: true }, select: { id: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const rememberCount = books.reduce((s, b) => s + b.notes.length, 0);

  return (
    <>
      <PageHeader title="Books" subtitle="What you've read and what you want to keep from it" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Books" value={books.length} />
        <StatCard label="Reading" value={books.filter((b) => b.status === 'READING').length} />
        <StatCard label="Finished" value={books.filter((b) => b.status === 'FINISHED').length} />
        <StatCard label="Remember items" value={rememberCount} hint="marked for flashcards" />
      </div>

      <Section title="Add a book">
        <Card>
          <form action={createBook} className="grid gap-2 md:grid-cols-[2fr_1.5fr_1fr_0.7fr_1fr_auto]">
            <input name="title" placeholder="Title *" required className={inputCls} />
            <input name="author" placeholder="Author" className={inputCls} />
            <input name="category" placeholder="Category" className={inputCls} />
            <input name="pageCount" type="number" min="1" placeholder="Pages" className={inputCls} />
            <select name="status" defaultValue="WANT_TO_READ" className={inputCls}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{fmtStatus(s)}</option>
              ))}
            </select>
            <button type="submit" className={btnPrimaryCls}>Add</button>
          </form>
        </Card>
      </Section>

      {books.length === 0 ? (
        <EmptyState>No books yet — add your first above.</EmptyState>
      ) : (
        STATUS_ORDER.map((status) => {
          const group = books.filter((b) => b.status === status);
          if (group.length === 0) return null;
          return (
            <Section key={status} title={STATUS_LABEL[status]}>
              <div className="grid gap-2 md:grid-cols-2">
                {group.map((b) => (
                  <Link key={b.id} href={`/books/${b.id}`}>
                    <Card className="flex items-center justify-between p-3 hover:border-accent/40 transition-colors">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{b.title}</div>
                        <div className="truncate text-[11px] text-muted">
                          {b.author ?? 'Unknown author'}
                          {b.category ? ` · ${b.category}` : ''}
                          {b.pageCount ? ` · ${b.pageCount.toLocaleString()} pages` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {b.rating != null && <span className="text-[11px] text-amber-400">{'★'.repeat(b.rating)}</span>}
                        <Badge tone={statusTone(b.status)}>{b._count.notes} notes</Badge>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </Section>
          );
        })
      )}
    </>
  );
}
