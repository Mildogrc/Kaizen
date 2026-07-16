import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { addBookNote, deleteBookNote, toggleNoteRemember, updateBook } from '@/lib/actions';
import { Badge, Card, EmptyState, PageHeader, Section, btnCls, btnPrimaryCls, inputCls, statusTone, fmtStatus } from '@/components/ui';

export const dynamic = 'force-dynamic';

const KINDS = ['NOTE', 'QUOTE', 'SUMMARY', 'IDEA', 'CHARACTER', 'ARGUMENT', 'DEFINITION', 'FORMULA', 'PASSAGE', 'REFLECTION'];
const STATUSES = ['WANT_TO_READ', 'READING', 'FINISHED', 'PAUSED', 'ABANDONED'];

export default async function BookDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: 'desc' } }, relatedCourse: true },
  });
  if (!book) notFound();

  const rememberNotes = book.notes.filter((n) => n.remember);

  return (
    <>
      <div className="mb-1 text-[12px]">
        <Link href="/books" className="text-muted hover:text-foreground">← Books</Link>
      </div>
      <PageHeader
        title={book.title}
        subtitle={[book.author, book.category, book.sourceLanguage].filter(Boolean).join(' · ') || undefined}
        actions={
          <form action={updateBook.bind(null, book.id)} className="flex items-center gap-2">
            <select name="status" defaultValue={book.status} className={inputCls}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{fmtStatus(s)}</option>
              ))}
            </select>
            <select name="rating" defaultValue={book.rating ?? ''} className={inputCls}>
              <option value="">no rating</option>
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>{'★'.repeat(r)}</option>
              ))}
            </select>
            <input
              name="pageCount"
              type="number"
              min="1"
              defaultValue={book.pageCount ?? ''}
              placeholder="Pages"
              className={`${inputCls} w-20`}
            />
            <button type="submit" className={btnCls}>Save</button>
          </form>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Badge tone={statusTone(book.status)}>{fmtStatus(book.status)}</Badge>
        {book.pageCount != null && <span>{book.pageCount.toLocaleString()} pages</span>}
        {book.startDate && <span>started {book.startDate.toISOString().slice(0, 10)}</span>}
        {book.finishDate && <span>finished {book.finishDate.toISOString().slice(0, 10)}</span>}
        {book.relatedCourse && <span>related course: {book.relatedCourse.name}</span>}
        <span>{book.notes.length} notes · {rememberNotes.length} marked remember</span>
      </div>

      <Section title="Add note">
        <Card>
          <form action={addBookNote.bind(null, book.id)} className="space-y-2">
            <textarea name="content" required rows={3} placeholder="Note, quote, idea, argument…" className={inputCls} />
            <div className="flex flex-wrap items-center gap-2">
              <select name="kind" defaultValue="NOTE" className={`${inputCls} w-auto`}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k.toLowerCase()}</option>
                ))}
              </select>
              <input name="location" placeholder="Ch. / page / loc." className={`${inputCls} w-36`} />
              <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
                <input type="checkbox" name="remember" /> remember this
              </label>
              <button type="submit" className={btnPrimaryCls}>Add note</button>
            </div>
          </form>
        </Card>
      </Section>

      <Section title={`Notes (${book.notes.length})`}>
        {book.notes.length === 0 ? (
          <EmptyState>No notes yet. Capture what you want to keep from this book.</EmptyState>
        ) : (
          <div className="space-y-2">
            {book.notes.map((note) => (
              <Card key={note.id} className="p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={note.kind === 'QUOTE' ? 'purple' : note.kind === 'IDEA' ? 'blue' : 'neutral'}>
                    {note.kind.toLowerCase()}
                  </Badge>
                  {note.location && <span className="text-[11px] text-muted">{note.location}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <form action={toggleNoteRemember.bind(null, note.id)}>
                      <button
                        type="submit"
                        title={note.remember ? 'Remove from review queue' : 'Mark: remember this'}
                        className={`rounded px-1.5 py-0.5 text-[11px] cursor-pointer ${note.remember ? 'bg-amber-950 text-amber-300' : 'text-muted hover:text-foreground'}`}
                      >
                        {note.remember ? '★ remember' : '☆ remember'}
                      </button>
                    </form>
                    <form action={deleteBookNote.bind(null, note.id)}>
                      <button type="submit" className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-red-400 cursor-pointer" title="Delete note">✕</button>
                    </form>
                  </span>
                </div>
                <p className={`whitespace-pre-wrap text-[13px] ${note.kind === 'QUOTE' ? 'italic border-l-2 border-purple-800 pl-2' : ''}`}>
                  {note.content}
                </p>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
