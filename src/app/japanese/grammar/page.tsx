import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, btnCls, btnPrimaryCls } from '@/components/ui';
import { prisma } from '@/lib/db';
import { GRAMMAR_NEW_PER_WEEK, GRAMMAR_PROMPT_VERSION, japaneseLevelFromKnownWords } from '@/lib/grammar-coach';
import { generateGrammarLessonAction } from './actions';
import { LessonResponseForm } from './lesson-response-form';

export const dynamic = 'force-dynamic';

function data(value: unknown) {
  const row = value as Record<string, unknown>;
  return { pattern: String(row.pattern ?? ''), meaning: String(row.meaning ?? ''), level: String(row.jlptLevel ?? '') };
}

export default async function GrammarCoachPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = query.returnTo?.startsWith('/') && !query.returnTo.startsWith('//') ? query.returnTo : '/japanese';
  const backLabel = returnTo === '/daily' ? 'Daily' : 'Japanese';
  const now = new Date();
  const [progress, storedLesson, wordStat] = await Promise.all([
    prisma.grammarProgress.findMany({ include: { learningItem: true }, orderBy: { curriculumOrder: 'asc' } }),
    prisma.grammarLesson.findFirst({ where: { status: 'GENERATED' }, orderBy: { scheduledFor: 'desc' } }),
    prisma.knownWordStat.findFirst({ where: { language: 'ja' }, orderBy: { date: 'desc' } }),
  ]);
  const lesson = storedLesson?.prompt.includes(GRAMMAR_PROMPT_VERSION) ? storedLesson : null;
  const needsPromptUpgrade = Boolean(storedLesson && !lesson);
  const counts = Object.fromEntries(['NEW', 'LEARNING', 'REVIEW', 'MASTERED'].map((status) => [status, progress.filter((item) => item.status === status).length]));
  const due = progress.filter((item) => item.status !== 'NEW' && item.dueAt <= now).length;
  const accuracyTotal = progress.reduce((sum, item) => sum + item.totalQuestions, 0);
  const accuracyCorrect = progress.reduce((sum, item) => sum + item.totalCorrect, 0);
  const knownWords = wordStat?.lower ?? 0;
  const levelLabel = japaneseLevelFromKnownWords(knownWords);
  const scheduledIds = lesson && Array.isArray(lesson.grammarItemIds)
    ? new Set(lesson.grammarItemIds.filter((id): id is string => typeof id === 'string'))
    : new Set<string>();
  const scheduled = progress.filter((item) => scheduledIds.has(item.learningItemId));
  const levelCounts = ['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => {
    const rows = progress.filter((item) => data(item.learningItem.data).level === level);
    return { level, total: rows.length, studied: rows.filter((item) => item.status !== 'NEW').length, mastered: rows.filter((item) => item.status === 'MASTERED').length };
  });
  const levelColors: Record<string, string> = { N5: '#4ade80', N4: '#38bdf8', N3: '#818cf8', N2: '#c084fc', N1: '#fb7185' };

  return (
    <>
      <PageHeader title="Japanese Grammar Coach" subtitle={`${GRAMMAR_NEW_PER_WEEK} new points per week, algorithmic SRS reviews, and an external-LLM lesson loop`} actions={<Link href={returnTo} className={btnCls}>← {backLabel}</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Unseen" value={counts.NEW} />
        <StatCard label="Learning" value={counts.LEARNING} />
        <StatCard label="Review" value={counts.REVIEW} />
        <StatCard label="Mastered" value={counts.MASTERED} />
        <StatCard label="Due now" value={due} />
        <StatCard label="Question accuracy" value={accuracyTotal ? `${Math.round((accuracyCorrect / accuracyTotal) * 100)}%` : '—'} />
      </div>

      <Section title="Curriculum progress">
        <Card>
          <div className="mb-3 text-[12px] text-muted">
            Level estimate: <strong className="text-foreground">{levelLabel}</strong> from a conservative {knownWords.toLocaleString()} known words. Grammar starts at zero independently of imported spreadsheet progress.
          </div>
          <div className="space-y-3">
            {levelCounts.map((level) => (
              <div key={level.level}>
                <div className="mb-1 flex justify-between text-[12px]">
                  <span className="font-medium">{level.level}</span>
                  <span className="text-muted tabular-nums">{Math.round((level.studied / level.total) * 100)}% · {level.studied}/{level.total} introduced · {level.mastered} mastered</span>
                </div>
                <ProgressBar pct={level.total ? (level.studied / level.total) * 100 : 0} color={levelColors[level.level]} />
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Today's lesson">
        {!lesson ? (
          <Card className="text-center">
            <p className="mb-3 text-[13px] text-muted">{needsPromptUpgrade ? 'Update the saved lesson to the sentence-first diagnostic format.' : 'Build a lesson from reviews due now and the next five-point weekly batch.'}</p>
            <form action={generateGrammarLessonAction}><button className={btnPrimaryCls}>{needsPromptUpgrade ? 'Update today\'s lesson' : 'Generate today\'s lesson'}</button></form>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold">Scheduled {lesson.scheduledFor.toLocaleDateString()}</div>
                  <div className="text-[11px] text-muted">Copy this into GPT or another LLM and complete the interactive lesson.</div>
                </div>
                <CopyButton text={lesson.prompt} label="⧉ Copy lesson prompt" primary />
              </div>
              <div className="flex flex-wrap gap-2">
                {scheduled.map((item) => {
                  const row = data(item.learningItem.data);
                  return <Badge key={item.id} tone={item.status === 'NEW' ? 'green' : item.isLeech ? 'red' : 'blue'}>{row.pattern} · {item.status === 'NEW' ? 'new' : 'review'}</Badge>;
                })}
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-[12px] text-accent">Preview full prompt</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[11px] leading-5 text-muted">{lesson.prompt}</pre>
              </details>
            </Card>
            <Card>
              <div className="mb-2 text-[13px] font-semibold">Import the tutor&apos;s final JSON</div>
              <p className="mb-3 text-[11px] text-muted">The app validates every scheduled point, updates SRS intervals, and sends the optional passage to Speed Reading.</p>
              <LessonResponseForm />
            </Card>
          </div>
        )}
      </Section>

      <Section title="Recently studied">
        {progress.every((item) => !item.lastStudiedAt) ? <EmptyState>No lesson results imported yet.</EmptyState> : (
          <Card className="p-0"><div className="divide-y divide-line">
            {progress.filter((item) => item.lastStudiedAt).sort((left, right) => (right.lastStudiedAt?.getTime() ?? 0) - (left.lastStudiedAt?.getTime() ?? 0)).slice(0, 12).map((item) => {
              const row = data(item.learningItem.data);
              return <div key={item.id} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                <span className="min-w-32 font-medium">{row.pattern}</span><span className="min-w-0 flex-1 truncate text-muted">{row.meaning}</span>
                <Badge tone={item.isLeech ? 'red' : item.status === 'MASTERED' ? 'green' : 'blue'}>{item.status.toLowerCase()}</Badge><span className="tabular-nums text-muted">{Math.round(item.intervalDays)}d</span>
              </div>;
            })}
          </div></Card>
        )}
      </Section>
    </>
  );
}
