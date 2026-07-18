import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ankiDueTodayCount, ankiRowsForMappings } from '@/lib/anki-data';
import { retention, streaks } from '@/lib/anki-analytics';
import { currentJlptProgress } from '@/lib/jlpt-progress';
import { levelBandProgressPercent } from '@/lib/progression';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, statusTone, fmtStatus, btnCls, btnPrimaryCls } from '@/components/ui';
import { GenerateButton } from '@/components/generate-button';

function ExamLevelTile({
  label,
  primaryProgress,
  secondaryProgress,
  complete,
  tone = 'cyan',
}: {
  label: string;
  primaryProgress: number;
  secondaryProgress?: number;
  complete: boolean;
  tone?: 'cyan' | 'amber';
}) {
  const primaryFill = complete ? 'bg-green-600/70' : tone === 'amber' ? 'bg-amber-500/55' : 'bg-cyan-500/55';
  const secondaryFill = complete ? 'bg-green-600/70' : 'bg-rose-500/55';
  const progressLabel = secondaryProgress == null
    ? `${Math.round(primaryProgress)}%`
    : `${Math.round(primaryProgress)}% vocabulary and ${Math.round(secondaryProgress)}% grammar`;

  return (
    <div
      className={`relative flex h-11 min-w-16 items-center justify-center overflow-hidden rounded-md border px-2 text-center ${complete ? 'border-green-600 text-green-100' : 'border-line bg-surface-2'}`}
      aria-label={`${label}: ${progressLabel}`}
    >
      {secondaryProgress == null ? (
        <div className={`absolute inset-x-0 bottom-0 ${primaryFill}`} style={{ height: `${primaryProgress}%` }} />
      ) : (
        <>
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
            <div className={`absolute inset-x-0 bottom-0 ${primaryFill}`} style={{ height: `${primaryProgress}%` }} />
          </div>
          <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden border-l border-line">
            <div className={`absolute inset-x-0 bottom-0 ${secondaryFill}`} style={{ height: `${secondaryProgress}%` }} />
          </div>
        </>
      )}
      <span className="relative z-10 text-[12px] font-semibold drop-shadow-sm">{label}</span>
    </div>
  );
}

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

  // Compact read-only Anki strip when this course has mapped decks.
  const ankiMappings = await prisma.ankiDeckMapping.findMany({ where: { courseId: course.id } });
  const wordLang = course.tab === 'JAPANESE' ? 'ja' : course.tab === 'CHINESE' ? 'zh' : null;
  const analyticsArea = course.tab === 'CHINESE' ? 'chinese' : 'japanese';
  const wordStat = wordLang
    ? await prisma.knownWordStat.findFirst({ where: { language: wordLang }, orderBy: { date: 'desc' } })
    : null;
  const grammarProgress = course.tab === 'JAPANESE'
    ? await prisma.grammarProgress.findMany({ include: { learningItem: { select: { data: true } } } })
    : [];
  const grammarByLevel = new Map<string, { total: number; mastered: number }>();
  for (const progress of grammarProgress) {
    const row = progress.learningItem.data as Record<string, unknown>;
    const level = String(row.jlptLevel ?? '');
    const counts = grammarByLevel.get(level) ?? { total: 0, mastered: 0 };
    counts.total++;
    if (progress.status === 'MASTERED') counts.mastered++;
    grammarByLevel.set(level, counts);
  }
  let matureKanjiCount = 0;
  let anki: { dueToday: number; streak: number; matureRetention: number | null; maturePct: number; deckNames: string } | null = null;
  if (ankiMappings.length > 0) {
    const { snapshots, logs } = await ankiRowsForMappings(ankiMappings.map((m) => m.id));
    const mature = snapshots.filter((s) => s.state === 'MATURE').length;
    const kanjiMappingIds = new Set(
      ankiMappings
        .filter((mapping) => /(?:kanji|rtk)/i.test(mapping.deckName))
        .map((mapping) => mapping.id),
    );
    matureKanjiCount = snapshots.filter((snapshot) => snapshot.state === 'MATURE' && snapshot.mappingId && kanjiMappingIds.has(snapshot.mappingId)).length;
    anki = {
      dueToday: await ankiDueTodayCount(course.id),
      streak: streaks(logs).current,
      matureRetention: retention(logs).mature,
      maturePct: snapshots.length > 0 ? Math.round((mature / snapshots.length) * 100) : 0,
      deckNames: ankiMappings.map((m) => m.deckName).join(' · '),
    };
  }

  const activeGoals = course.goals.filter((g) => g.status === 'ACTIVE');
  const plannedGoals = course.goals.filter((g) => g.status === 'PLANNED');
  const jlptExam = course.exams.find((exam) => exam.slug === 'jlpt');
  const japaneseGoal = course.tab === 'JAPANESE' && jlptExam
    ? currentJlptProgress(jlptExam.levels.map((level) => {
        const targets = level.targets as Record<string, number>;
        const grammar = grammarByLevel.get(level.name) ?? { total: targets.targetGrammar ?? 0, mastered: 0 };
        return {
          name: level.name,
          rank: level.rank,
          targetVocab: targets.targetVocab ?? 0,
          grammarTotal: grammar.total,
          grammarMastered: grammar.mastered,
        };
      }), wordStat?.lower ?? 0)
    : undefined;

  return (
    <>
      <PageHeader
        title={course.name}
        subtitle={course.description ?? undefined}
        actions={
          <>
            {course.slug === 'japanese' && <Link href="/japanese/grammar" className={btnPrimaryCls}>文 Grammar coach</Link>}
            {course.slug === 'chinese' && <Link href="/chinese/mandarin-blueprint" className={btnPrimaryCls}>蓝 Mandarin Blueprint</Link>}
            <GenerateButton courseId={course.id} />
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

      {anki && (
        <div className="mb-6 rounded-lg border border-line bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
            <span className="font-semibold text-muted">★ Anki</span>
            <span>due today <span className="font-semibold tabular-nums text-accent">{anki.dueToday}</span></span>
            <span>streak <span className="font-semibold tabular-nums">{anki.streak}d</span></span>
            <span>mature retention <span className="font-semibold tabular-nums">{anki.matureRetention === null ? '—' : `${Math.round(anki.matureRetention * 100)}%`}</span></span>
            <span>mature <span className="font-semibold tabular-nums">{anki.maturePct}%</span></span>
            {wordStat && (
              <Link href={`/analytics?area=${analyticsArea}`} className="hover:underline">
                known words{' '}
                <span className="font-semibold tabular-nums text-cyan-300">
                  {wordStat.lower === wordStat.upper ? wordStat.lower : `${wordStat.lower}–${wordStat.upper}`}
                </span>
              </Link>
            )}
            {course.tab === 'JAPANESE' && (
              <Link href="/analytics?area=japanese" className="hover:underline">
                kanji <span className="font-semibold tabular-nums text-amber-300">{matureKanjiCount.toLocaleString()}</span>
              </Link>
            )}
            <Link href={`/analytics?area=${analyticsArea}`} className="ml-auto text-accent hover:underline">full analytics →</Link>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">{anki.deckNames}</div>
        </div>
      )}

      <Section title="Current goal">
        {course.tab === 'JAPANESE' ? japaneseGoal ? (
          <Card className="max-w-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">Prepare for JLPT {japaneseGoal.name}</span>
              <Badge tone="blue">active</Badge>
            </div>
            <div className="mt-2"><ProgressBar pct={japaneseGoal.overallProgress} color={course.color ?? undefined} /></div>
            <p className="mt-1.5 text-[12px] text-muted tabular-nums">{japaneseGoal.wordsRemaining.toLocaleString()} words left · {japaneseGoal.grammarRemaining.toLocaleString()} grammar points left</p>
          </Card>
        ) : (
          <Card className="max-w-xl border-green-800/60 p-3 text-green-200">JLPT N5–N1 vocabulary and grammar complete.</Card>
        ) : activeGoals.length === 0 ? (
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
                {exam.levels.map((level, levelIndex) => {
                  const targets = level.targets as Record<string, number>;
                  const previousTargets = levelIndex > 0
                    ? exam.levels[levelIndex - 1].targets as Record<string, number>
                    : {};
                  const grammar = grammarByLevel.get(level.name);
                  const wordProgress = levelBandProgressPercent(wordStat?.lower ?? 0, targets.targetVocab, previousTargets.targetVocab);
                  const grammarProgressPercent = levelBandProgressPercent(grammar?.mastered ?? 0, grammar?.total);
                  const kanjiProgress = levelBandProgressPercent(matureKanjiCount, targets.targetKanji, previousTargets.targetKanji);
                  const isJlpt = exam.slug === 'jlpt';
                  const isHsk = exam.slug === 'hsk';
                  const isKanken = exam.slug === 'kanji-kentei';
                  const primaryProgress = isKanken ? kanjiProgress : isJlpt || isHsk ? wordProgress : 0;
                  const complete = isJlpt
                    ? wordProgress === 100 && grammarProgressPercent === 100
                    : isHsk || isKanken
                      ? primaryProgress === 100
                      : false;
                  return (
                    <ExamLevelTile
                      key={level.id}
                      label={level.name}
                      primaryProgress={primaryProgress}
                      secondaryProgress={isJlpt ? grammarProgressPercent : undefined}
                      complete={complete}
                      tone={isKanken ? 'amber' : 'cyan'}
                    />
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

      <details className="mb-3 rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Content databases <span className="text-muted">({course.schemas.length})</span></summary>
        <div className="grid gap-2 border-t border-line p-4 md:grid-cols-2">
          {course.schemas.map((schema) => (
            <Link key={schema.id} href={`/schemas/${schema.slug}`}>
              <Card className="flex items-center justify-between p-3 hover:border-accent/40 transition-colors">
                <div><div className="text-[13px] font-medium">{schema.name}</div><div className="text-[11px] text-muted">{schema.itemType}</div></div>
                <span className="text-lg font-semibold tabular-nums text-muted">{schema._count.learningItems}</span>
              </Card>
            </Link>
          ))}
        </div>
      </details>

      <details className="mb-6 rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">Recent imports <span className="text-muted">({course.importBatches.length})</span></summary>
        <div className="border-t border-line p-4">{course.importBatches.length === 0 ? (
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
        )}</div>
      </details>
    </>
  );
}
