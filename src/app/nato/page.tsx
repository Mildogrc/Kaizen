import Link from 'next/link';
import { prisma } from '@/lib/db';
import { analyzeNatoSessions, selectNatoWord } from '@/lib/nato';
import { Card, EmptyState, PageHeader, Section, StatCard, btnCls } from '@/components/ui';
import { NatoTrainer } from './trainer';

export const dynamic = 'force-dynamic';

export default async function NatoPage() {
  const sessions = await prisma.studySession.findMany({ where: { mode: 'nato' }, orderBy: { date: 'asc' } });
  const analytics = analyzeNatoSessions(sessions.map((session) => ({ date: session.date, stats: session.stats })));
  const word = selectNatoWord(analytics.metrics, analytics.sessions);
  const practiced = analytics.metrics.filter((metric) => metric.attempts > 0).sort((left, right) => right.averageMs - left.averageMs);
  return <>
    <PageHeader title="NATO Recall" subtitle="Timed code-word recall weighted toward slow and missed letters" actions={<><Link href="/skills" className={btnCls}>← Random Skills</Link><Link href="/analytics?area=nato" className={btnCls}>Analytics →</Link></>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><StatCard label="Sessions" value={analytics.sessions} /><StatCard label="Recall accuracy" value={analytics.accuracy == null ? '—' : `${Math.round(analytics.accuracy * 100)}%`} /><StatCard label="Average recall" value={analytics.averageRecallMs == null ? '—' : `${(analytics.averageRecallMs / 1_000).toFixed(1)}s`} /><StatCard label="Next due" value={analytics.nextDueAt ? analytics.nextDueAt.toLocaleDateString() : 'Now'} hint="7–28 day adaptive interval" /></div>
    <Section title={`Timed word · ${word.length} letters`}><NatoTrainer word={word} /></Section>
    <Section title="Letter recall">{practiced.length === 0 ? <EmptyState>Complete the first timed word to begin letter analytics.</EmptyState> : <Card className="p-0"><div className="divide-y divide-line">{practiced.map((metric) => <div key={metric.letter} className="grid grid-cols-[3rem_1fr_auto_auto] items-center gap-3 px-4 py-2 text-[12px]"><span className="text-lg font-semibold">{metric.letter}</span><div className="h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, (metric.averageMs / 5_000) * 100)}%` }} /></div><span className="tabular-nums">{(metric.averageMs / 1_000).toFixed(1)}s</span><span className="text-muted tabular-nums">{Math.round(metric.accuracy * 100)}% · {metric.attempts}</span></div>)}</div></Card>}</Section>
  </>;
}
