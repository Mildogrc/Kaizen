import Link from 'next/link';
import { Card, EmptyState, PageHeader, Section, StatCard, btnCls } from '@/components/ui';
import { prisma } from '@/lib/db';
import { speedReadingConfiguration } from '@/lib/app-settings';
import { DEFAULT_READING_WPM, readingStreak } from '@/lib/speed-reading';
import { PassageImport } from './passage-import';
import { RetentionChecks, type RetentionCheck } from './retention-checks';
import { SpeedReadingTrainer, type TrainerPassage, type TrainerQuestion } from './trainer';

export const dynamic = 'force-dynamic';

function questions(value: unknown): TrainerQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question) => {
    if (!question || typeof question !== 'object') return [];
    const row = question as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.prompt !== 'string' || !Array.isArray(row.choices)) return [];
    const choices = row.choices.filter((choice): choice is string => typeof choice === 'string');
    return choices.length >= 2 ? [{ id: row.id, prompt: row.prompt, choices }] : [];
  });
}

export default async function SpeedReadingPage() {
  const now = new Date();
  const [passageRows, sessions, dueRows, user] = await Promise.all([
    prisma.speedReadingPassage.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.speedReadingSession.findMany({ orderBy: { completedAt: 'asc' } }),
    prisma.speedReadingSession.findMany({ where: { retentionDueAt: { lte: now }, retentionCompletedAt: null }, include: { passage: true }, orderBy: { retentionDueAt: 'asc' }, take: 5 }),
    prisma.user.findFirst(),
  ]);
  const settings = speedReadingConfiguration(user?.settings);
  const passages: TrainerPassage[] = passageRows.map((passage) => ({ id: passage.id, title: passage.title, topic: passage.topic, category: passage.category, difficulty: passage.difficulty, sourceUrl: passage.sourceUrl, text: passage.text, wordCount: passage.wordCount, questions: questions(passage.questions) })).filter((passage) => passage.questions.length > 0);
  const dueChecks: RetentionCheck[] = dueRows.map((session) => ({ sessionId: session.id, title: session.passage.title, readAt: session.completedAt.toISOString(), questions: questions(session.passage.questions) })).filter((check) => check.questions.length > 0);
  const latest = sessions.at(-1);
  const recommendedWpm = latest?.recommendedNextWpm ?? settings.wpm ?? DEFAULT_READING_WPM;
  const averageAccuracy = sessions.length ? sessions.reduce((sum, session) => sum + session.accuracy, 0) / sessions.length : null;
  const streak = readingStreak(sessions.map((session) => session.completedAt));

  return <>
    <PageHeader title="Speed Reading" subtitle="A focused reading session with comprehension checks" actions={<Link href="/configurations?section=random-skills&skill=reading" className={btnCls}>⚙ Configure</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Next speed" value={`${recommendedWpm} WPM`} />
      <StatCard label="Comprehension" value={averageAccuracy == null ? '—' : `${Math.round(averageAccuracy * 100)}%`} />
      <StatCard label="Streak" value={`${streak.current}d`} />
      <StatCard label="Retention due" value={dueChecks.length} />
    </div>
    {dueChecks.length > 0 && <Section title="Retention"><RetentionChecks checks={dueChecks} /></Section>}
    <Section title="Start reading">{passages.length ? <SpeedReadingTrainer passages={passages} recommendedWpm={recommendedWpm} settings={settings} /> : <EmptyState>Import a passage below to begin.</EmptyState>}</Section>
    <details className="mb-6 rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Add or generate a passage</summary>
      <div className="border-t border-line p-4"><PassageImport /></div>
    </details>
    <Card className="flex items-center justify-between p-3 text-[12px] text-muted"><span>Detailed speed, comprehension, topic, and difficulty trends live under Analytics.</span><Link href="/analytics?area=reading" className="text-accent hover:underline">Reading analytics →</Link></Card>
  </>;
}
