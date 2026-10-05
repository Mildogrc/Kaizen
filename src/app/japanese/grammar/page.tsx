import Link from 'next/link';
import { Bars } from '@/components/anki-charts';
import { CopyButton } from '@/components/copy-button';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, Section, StatCard, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { prisma } from '@/lib/db';
import { analyzeGrammarLearning } from '@/lib/grammar-analytics';
import { japaneseGrammarConfiguration, japaneseGrammarTutorConfiguration } from '@/lib/app-settings';
import {
  GRAMMAR_PROMPT_VERSION,
  buildGrammarTutorLessonPlan,
  grammarTutorMissRatePercent,
  grammarLessonMatchesQueue,
  japaneseLevelFromKnownWords,
  recordedGrammarMissRatePercent,
  selectGrammarQueue,
  selectWorstGrammarPoints,
} from '@/lib/grammar-coach';
import { generateGrammarLessonAction, updateGrammarTutorConfigurationAction } from './actions';
import { LessonResponseForm } from './lesson-response-form';

export const dynamic = 'force-dynamic';

function data(value: unknown) {
  const row = value as Record<string, unknown>;
  return {
    pattern: String(row.pattern ?? ''),
    meaning: String(row.meaning ?? ''),
    level: String(row.jlptLevel ?? ''),
    examples: Array.isArray(row.examples) ? row.examples.filter((example): example is string => typeof example === 'string') : [],
  };
}

export default async function GrammarCoachPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = query.returnTo?.startsWith('/') && !query.returnTo.startsWith('//') ? query.returnTo : '/japanese';
  const backLabel = returnTo === '/daily' ? 'Daily' : 'Japanese';
  const now = new Date();
  const [progress, storedLesson, wordStat, completedLessons, importedPassages, user] = await Promise.all([
    prisma.grammarProgress.findMany({ include: { learningItem: true }, orderBy: { curriculumOrder: 'asc' } }),
    prisma.grammarLesson.findFirst({ where: { status: 'GENERATED' }, orderBy: { scheduledFor: 'desc' } }),
    prisma.knownWordStat.findFirst({ where: { language: 'ja' }, orderBy: { date: 'desc' } }),
    prisma.grammarLesson.findMany({ where: { completedAt: { not: null } }, select: { completedAt: true, response: true }, orderBy: { completedAt: 'asc' } }),
    prisma.speedReadingPassage.count({ where: { source: 'grammar-lesson' } }),
    prisma.user.findFirst({ select: { settings: true } }),
  ]);
  const grammarConfiguration = japaneseGrammarConfiguration(user?.settings);
  const grammarTutorConfiguration = japaneseGrammarTutorConfiguration(user?.settings);
  const queue = selectGrammarQueue(progress, now, grammarConfiguration);
  const scheduledWorkCount = queue.reviewIds.length + queue.newIds.length;
  const currentPrompt = storedLesson?.prompt.includes(GRAMMAR_PROMPT_VERSION) ? storedLesson : null;
  const lesson = currentPrompt && grammarLessonMatchesQueue(currentPrompt, queue, now) ? currentPrompt : null;
  const needsPromptUpgrade = Boolean(storedLesson && !currentPrompt);
  const needsLessonRefresh = Boolean(currentPrompt && !lesson);
  const counts = Object.fromEntries(['NEW', 'LEARNING', 'REVIEW', 'MASTERED'].map((status) => [status, progress.filter((item) => item.status === status).length]));
  const grammarAnalytics = analyzeGrammarLearning(progress, completedLessons, importedPassages, now);
  const knownWords = wordStat?.lower ?? 0;
  const levelLabel = japaneseLevelFromKnownWords(knownWords);
  const scheduledIds = lesson && Array.isArray(lesson.grammarItemIds)
    ? lesson.grammarItemIds.filter((id): id is string => typeof id === 'string')
    : [];
  const progressByLearningItemId = new Map(progress.map((item) => [item.learningItemId, item]));
  const scheduled = scheduledIds.flatMap((learningItemId) => {
    const item = progressByLearningItemId.get(learningItemId);
    return item ? [item] : [];
  });
  const tutorPlanItems = progress.map((item) => {
    const row = data(item.learningItem.data);
    return {
      learningItemId: item.learningItemId,
      pattern: row.pattern,
      meaning: row.meaning,
      jlptLevel: row.level,
      examples: row.examples,
      curriculumOrder: item.curriculumOrder,
      totalCorrect: item.totalCorrect,
      totalQuestions: item.totalQuestions,
      lapseCount: item.lapseCount,
      isLeech: item.isLeech,
      lastRating: item.lastRating,
    };
  });
  const weakestGrammarPoints = selectWorstGrammarPoints(
    tutorPlanItems,
    grammarTutorConfiguration.planSize,
    grammarTutorConfiguration.itemOverrides,
  );
  const tutorLessonPlan = buildGrammarTutorLessonPlan(tutorPlanItems, grammarTutorConfiguration);
  const configurableTutorItems = tutorPlanItems
    .filter((item) => item.totalQuestions > 0
      || item.lapseCount > 0
      || item.isLeech
      || item.lastRating === 'AGAIN'
      || item.lastRating === 'HARD'
      || Object.prototype.hasOwnProperty.call(grammarTutorConfiguration.itemOverrides, item.learningItemId))
    .sort((left, right) => grammarTutorMissRatePercent(right, grammarTutorConfiguration.itemOverrides[right.learningItemId])
      - grammarTutorMissRatePercent(left, grammarTutorConfiguration.itemOverrides[left.learningItemId])
      || left.curriculumOrder - right.curriculumOrder);
  const levelCounts = ['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => {
    const rows = progress.filter((item) => data(item.learningItem.data).level === level);
    return { level, total: rows.length, studied: rows.filter((item) => item.status !== 'NEW').length, mastered: rows.filter((item) => item.status === 'MASTERED').length };
  });
  const levelColors: Record<string, string> = { N5: '#4ade80', N4: '#38bdf8', N3: '#818cf8', N2: '#c084fc', N1: '#fb7185' };

  return (
    <>
      <PageHeader title="Japanese Grammar Coach" subtitle={`${grammarConfiguration.newPointsPerBatch} new points every ${grammarConfiguration.newBatchIntervalDays} ${grammarConfiguration.newBatchIntervalDays === 1 ? 'day' : 'days'}, algorithmic SRS reviews, and an external-LLM lesson loop`} actions={<Link href={returnTo} className={btnCls}>← {backLabel}</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Unseen" value={counts.NEW} />
        <StatCard label="Learning" value={counts.LEARNING} />
        <StatCard label="Review" value={counts.REVIEW} />
        <StatCard label="Mastered" value={counts.MASTERED} />
        <StatCard label="Due now" value={grammarAnalytics.due} />
        <StatCard label="Question accuracy" value={grammarAnalytics.accuracy == null ? '—' : `${Math.round(grammarAnalytics.accuracy * 100)}%`} />
      </div>

      <Section title="Lesson analytics">
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Completed lessons" value={grammarAnalytics.completedLessons} hint={`${grammarAnalytics.lessonsToday} today`} />
          <StatCard label="Answers" value={`${grammarAnalytics.totalCorrect}/${grammarAnalytics.totalQuestions}`} hint="correct / total" />
          <StatCard label="Lesson streak" value={`${grammarAnalytics.currentStreak}d`} />
          <StatCard label="Reading passages" value={grammarAnalytics.importedPassages} hint="created by grammar lessons" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card><div className="mb-2 text-[12px] font-medium">Rating distribution</div><Bars height={100} data={grammarAnalytics.ratingDistribution} color="#38bdf8" /></Card>
          <Card><div className="mb-2 text-[12px] font-medium">Grammar results by week</div><Bars height={100} data={grammarAnalytics.weeklyProgress} color="#4ade80" /></Card>
        </div>
      </Section>

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
          scheduledWorkCount === 0
            ? <EmptyState>Nothing is due today. The next weekly batch and future reviews will appear automatically.</EmptyState>
            : <Card className="text-center">
              <p className="mb-3 text-[13px] text-muted">
                {needsPromptUpgrade
                  ? 'Update the saved lesson to the new Again / Good / Perfect format.'
                  : needsLessonRefresh
                    ? 'The saved lesson is from an older queue. Refresh it to include everything due today.'
                    : `Build a lesson from reviews due now and the next ${grammarConfiguration.newPointsPerBatch}-point batch.`}
              </p>
              <form action={generateGrammarLessonAction}><button className={btnPrimaryCls}>{needsPromptUpgrade || needsLessonRefresh ? 'Refresh today\'s lesson' : 'Generate today\'s lesson'}</button></form>
            </Card>
        ) : (
          <div className="space-y-3">
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold">Scheduled {lesson.scheduledFor.toLocaleDateString()}</div>
                  <div className="text-[11px] text-muted">Copy this into GPT or another LLM. It will finish with a simple numbered rating list.</div>
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
              <div className="mb-2 text-[13px] font-semibold">Save the tutor&apos;s ratings</div>
              <p className="mb-3 text-[11px] text-muted">Match GPT&apos;s numbered Again / Good / Perfect list to the same numbered grammar points. The app creates and validates the SRS update.</p>
              <LessonResponseForm
                lessonId={lesson.id}
                items={scheduled.map((item) => {
                  const row = data(item.learningItem.data);
                  return {
                    learningItemId: item.learningItemId,
                    pattern: row.pattern,
                    meaning: row.meaning,
                    kind: item.status === 'NEW' ? 'new' as const : 'review' as const,
                  };
                })}
              />
            </Card>
          </div>
        )}
      </Section>

      <Section title="Tutor lesson plan">
        <Card>
          {!tutorLessonPlan ? <EmptyState>No included grammar points currently need extra tutor practice.</EmptyState> : (
            <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold">Weakest recurring points by miss rate</div>
                <p className="mt-1 text-[11px] text-muted">Ranked primarily by the percentage of recorded answers missed. Your tutor-only adjustments are applied before the plan is generated.</p>
              </div>
              <CopyButton text={tutorLessonPlan} label="⧉ Generate lesson plan" primary />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {weakestGrammarPoints.map((item) => <Badge key={item.learningItemId} tone={item.isLeech ? 'red' : 'amber'}>{item.pattern} · {grammarTutorMissRatePercent(item, grammarTutorConfiguration.itemOverrides[item.learningItemId])}% missed</Badge>)}
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-[12px] text-accent">Preview tutor plan</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[11px] leading-5 text-muted">{tutorLessonPlan}</pre>
            </details>
            </>
          )}
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-[12px] font-medium text-accent">Customize internal lesson generation</summary>
            <p className="mt-2 text-[11px] text-muted">Change a point&apos;s tutor-plan percentage, leave it blank to use recorded history, or remove it from tutor plans. These controls do not alter SRS scheduling or analytics.</p>
            <form action={updateGrammarTutorConfigurationAction} className="mt-3 space-y-3">
              <label className="block max-w-48 text-[11px] text-muted">Points in each tutor plan<input name="planSize" type="number" min="1" max="10" defaultValue={grammarTutorConfiguration.planSize} className={`${inputCls} mt-1`} /></label>
              {configurableTutorItems.length === 0 ? (
                <div className="text-[12px] text-muted">No attempted grammar points are available to customize yet.</div>
              ) : (
                <div className="divide-y divide-line rounded-md border border-line">
                  {configurableTutorItems.map((item) => {
                    const override = grammarTutorConfiguration.itemOverrides[item.learningItemId];
                    const recordedMissRate = recordedGrammarMissRatePercent(item);
                    return (
                      <div key={item.learningItemId} className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-end">
                        <input type="hidden" name="learningItemId" value={item.learningItemId} />
                        <div>
                          <div className="text-[12px] font-medium">{item.pattern}</div>
                          <div className="mt-0.5 text-[11px] text-muted">Recorded: {recordedMissRate}% missed · {Math.max(0, item.totalQuestions - item.totalCorrect)}/{item.totalQuestions} attempts</div>
                        </div>
                        <label className="text-[11px] text-muted">Tutor-plan missed %<input name={`missRatePercent:${item.learningItemId}`} type="number" min="0" max="100" placeholder={String(recordedMissRate)} defaultValue={override?.missRatePercent ?? ''} className={`${inputCls} mt-1`} /></label>
                        <label className="flex h-8 items-center gap-2 text-[12px]"><input name={`excluded:${item.learningItemId}`} type="checkbox" defaultChecked={override?.excluded === true} />Remove from plans</label>
                      </div>
                    );
                  })}
                </div>
              )}
              <button className={btnPrimaryCls}>Save tutor-plan settings</button>
            </form>
          </details>
        </Card>
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
