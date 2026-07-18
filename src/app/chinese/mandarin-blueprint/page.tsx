import Link from 'next/link';
import { prisma } from '@/lib/db';
import { jsonStrings } from '@/lib/mandarin-blueprint';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, StatCard, btnCls } from '@/components/ui';
import { LevelAction } from './level-action';

export const dynamic = 'force-dynamic';

export default async function MandarinBlueprintPage() {
  const [levels, dictionaryEntries] = await Promise.all([
    prisma.mandarinBlueprintLevel.findMany({ orderBy: { level: 'asc' } }),
    prisma.mandarinDictionaryEntry.count(),
  ]);
  const completed = levels.filter((level) => level.completedAt).length;
  const pushed = levels.filter((level) => level.pushedAt).length;
  const currentLevel = levels.find((level) => !level.completedAt)?.level ?? 88;
  return <>
    <PageHeader title="Mandarin Blueprint" subtitle="Complete a course level, cache its dictionary data, and push new characters and words to Anki" actions={<><Link href="/chinese" className={btnCls}>← Chinese</Link><Link href="/configurations?section=chinese" className={btnCls}>Deck settings</Link></>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><StatCard label="Course levels" value={levels.length || 88} /><StatCard label="Completed" value={`${completed}/88`} /><StatCard label="Pushed to Anki" value={pushed} /><StatCard label="Dictionary cache" value={dictionaryEntries.toLocaleString()} hint="Chisho entries" /></div>
    <div className="mb-6"><div className="mb-1 flex justify-between text-[11px] text-muted"><span>Course completion</span><span>{Math.round((completed / 88) * 100)}%</span></div><ProgressBar pct={(completed / 88) * 100} color="#ef4444" /></div>
    {levels.length === 0 ? <EmptyState>Run <code>npm run db:import-mandarin -- &quot;/path/to/MandarinBluePrint.csv&quot;</code> once to load the 88-level catalog.</EmptyState> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{levels.map((level) => {
      const characters = jsonStrings(level.characters);
      const words = jsonStrings(level.words);
      const isCurrent = level.level === currentLevel;
      return <Card key={level.id} className={`${isCurrent ? 'border-accent/60' : ''} ${level.pushedAt ? 'border-green-800/60 bg-green-950/10' : ''}`}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[15px] font-semibold">Level {level.level}</div><div className="mt-0.5 text-[11px] text-muted">Phase {level.phase ?? '—'} · {characters.length} new characters · {words.length} new words</div></div><Badge tone={level.pushedAt ? 'green' : level.pushError ? 'red' : level.completedAt ? 'amber' : isCurrent ? 'blue' : 'neutral'}>{level.pushedAt ? 'in Anki' : level.pushError ? 'push failed' : level.completedAt ? 'completed' : isCurrent ? 'current' : 'ready'}</Badge></div>
        <details className="mt-3 text-[11px]"><summary className="cursor-pointer text-accent">Preview level content</summary><div className="mt-2 max-h-36 overflow-auto rounded bg-surface-2 p-2"><div><span className="text-muted">Characters:</span> {characters.join(' ') || '—'}</div><div className="mt-2"><span className="text-muted">Words:</span> {words.join(' · ') || '—'}</div></div></details>
        {level.pushError && <div className="mt-2 rounded border border-red-900 bg-red-950/30 px-2 py-1.5 text-[11px] text-red-300">{level.pushError}</div>}
        <LevelAction level={level.level} completed={Boolean(level.completedAt)} pushed={Boolean(level.pushedAt)} />
      </Card>;
    })}</div>}
  </>;
}
