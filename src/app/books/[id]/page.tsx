import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { addBookNote, addBookReadingSession, deleteBookNote, toggleNoteRemember, updateBook } from '@/lib/actions';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, btnCls, btnPrimaryCls, inputCls, statusTone, fmtStatus } from '@/components/ui';

export const dynamic = 'force-dynamic';

const KINDS = ['NOTE', 'QUOTE', 'SUMMARY', 'IDEA', 'CHARACTER', 'ARGUMENT', 'DEFINITION', 'FORMULA', 'PASSAGE', 'REFLECTION'];
const STATUSES = ['WANT_TO_READ', 'READING', 'FINISHED', 'PAUSED', 'ABANDONED'];

export default async function BookDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo?.startsWith('/') && !query.returnTo.startsWith('//') ? query.returnTo : `/books/${id}`;
  const book = await prisma.book.findUnique({
    where: { id },
    include: {
      notes: { orderBy: { createdAt: 'desc' } },
      readingSessions: { orderBy: { readAt: 'desc' } },
      relatedCourse: true,
    },
  });
  if (!book) notFound();

  const rememberNotes = book.notes.filter((n) => n.remember);
  const totalPagesRead = book.readingSessions.reduce((sum, session) => sum + session.pagesRead, 0);
  const totalMinutes = book.readingSessions.reduce((sum, session) => sum + session.durationMin, 0);
  const currentPage = Math.max(0, ...book.readingSessions.map((session) => session.endPage ?? 0));
  const pagesPerHour = totalMinutes === 0 ? 0 : Math.round((totalPagesRead / totalMinutes) * 60);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="mb-1 text-[12px]">
        <Link href={query.returnTo ? returnTo : '/books'} className="text-muted hover:text-foreground">← {query.returnTo === '/daily' ? 'Daily' : 'Books'}</Link>
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

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Current page" value={currentPage || '—'} hint={book.pageCount ? `of ${book.pageCount.toLocaleString()}` : undefined} />
        <StatCard label="Pages logged" value={totalPagesRead.toLocaleString()} />
        <StatCard label="Time spent" value={totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`} />
        <StatCard label="Reading pace" value={pagesPerHour ? `${pagesPerHour}/h` : '—'} hint="pages per hour" />
      </div>

      {book.pageCount && currentPage > 0 && (
        <div className="mb-6">
          <div className="mb-1 flex justify-between text-[11px] text-muted"><span>Book progress</span><span>{Math.round((currentPage / book.pageCount) * 100)}%</span></div>
          <ProgressBar pct={(currentPage / book.pageCount) * 100} />
        </div>
      )}

      <Section title="Log reading" className="mb-6" >
        <Card>
          <form id="reading-log" action={addBookReadingSession.bind(null, book.id, returnTo)} className="grid gap-2 md:grid-cols-[0.8fr_0.8fr_0.8fr_1fr_1.5fr_auto]">
            <input name="pagesRead" type="number" min="1" required placeholder="Pages read *" className={inputCls} />
            <input name="endPage" type="number" min="1" max={book.pageCount ?? undefined} placeholder="Current page" className={inputCls} />
            <input name="durationMin" type="number" min="1" required placeholder="Minutes *" className={inputCls} />
            <input name="readAt" type="date" defaultValue={today} className={inputCls} />
            <input name="notes" placeholder="Session note (optional)" className={inputCls} />
            <button type="submit" className={btnPrimaryCls}>Save reading</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">If current page is blank, it advances from your last logged page by the number of pages read.</p>
        </Card>
      </Section>

      <Section title={`Reading sessions (${book.readingSessions.length})`}>
        {book.readingSessions.length === 0 ? (
          <EmptyState>No reading sessions logged yet.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-line text-muted">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Pages</th><th className="px-3 py-2 text-right">Position</th><th className="px-3 py-2 text-right">Time</th><th className="px-3 py-2 text-right">Pace</th><th className="px-3 py-2">Note</th></tr>
              </thead>
              <tbody>
                {book.readingSessions.map((session) => (
                  <tr key={session.id} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2">{session.readAt.toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{session.pagesRead}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{session.startPage && session.endPage ? `${session.startPage}–${session.endPage}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{session.durationMin}m</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round((session.pagesRead / session.durationMin) * 60)}/h</td>
                    <td className="max-w-xs truncate px-3 py-2 text-muted">{session.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

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
