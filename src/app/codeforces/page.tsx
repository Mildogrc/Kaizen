import Link from 'next/link';
import { prisma } from '@/lib/db';
import { analyzeCodeforces, codeforcesProblemKey, type CodeforcesProblem } from '@/lib/codeforces';
import { ActivityHeatmap, Bars, MetricLine } from '@/components/anki-charts';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard } from '@/components/ui';
import { CodeforcesConnectForm } from './connect-form';

export const dynamic = 'force-dynamic';

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

export default async function CodeforcesPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const query = await searchParams;
  const profiles = await prisma.codeforcesProfile.findMany({ orderBy: { updatedAt: 'desc' } });
  const selected = profiles.find((profile) => profile.id === query.profile) ?? profiles[0] ?? null;

  const submissions = selected
    ? await prisma.codeforcesSubmission.findMany({
        where: { profileId: selected.id },
        orderBy: { submittedAt: 'desc' },
      })
    : [];
  const ratingChanges = selected
    ? await prisma.codeforcesRatingChange.findMany({
        where: { profileId: selected.id },
        orderBy: { updatedAt: 'asc' },
      })
    : [];

  const rows = submissions.map((submission) => ({
    codeforcesId: submission.codeforcesId,
    submittedAt: submission.submittedAt,
    verdict: submission.verdict,
    problem: {
      contestId: submission.contestId ?? undefined,
      index: submission.problemIndex,
      name: submission.problemName,
      rating: submission.problemRating ?? undefined,
      tags: tags(submission.problemTags),
    },
  }));
  const analytics = analyzeCodeforces(
    rows,
    ratingChanges.map((change) => ({
      contestId: change.contestId,
      contestName: change.contestName,
      contestRank: change.contestRank,
      oldRating: change.oldRating,
      newRating: change.newRating,
      updatedAt: change.updatedAt,
    })),
  );

  const recentSolved = new Map<string, { problem: CodeforcesProblem; submittedAt: Date }>();
  for (const submission of rows) {
    if (submission.verdict !== 'OK') continue;
    const key = codeforcesProblemKey(submission.problem);
    if (!recentSolved.has(key)) recentSolved.set(key, { problem: submission.problem, submittedAt: submission.submittedAt });
    if (recentSolved.size >= 12) break;
  }

  return (
    <>
      <PageHeader
        title="Codeforces"
        subtitle="Problem-rating analytics, contest performance, and consistency from a public Codeforces profile"
      />

      <Section title="Connect a profile">
        <Card>
          <CodeforcesConnectForm initialValue={selected?.profileUrl ?? ''} />
          <p className="mt-2 text-[11px] text-muted">
            Public data only. A sync reads the profile, up to 10,000 submissions, and rated-contest history.
          </p>
        </Card>
      </Section>

      {profiles.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {profiles.map((profile) => (
            <Link
              key={profile.id}
              href={`/codeforces?profile=${profile.id}`}
              className={`rounded-md border px-2.5 py-1 text-[12px] ${selected?.id === profile.id ? 'border-accent text-accent' : 'border-line text-muted'}`}
            >
              {profile.handle}
            </Link>
          ))}
        </div>
      )}

      {!selected ? (
        <EmptyState>Paste a Codeforces profile URL above to build the dashboard.</EmptyState>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <a href={selected.profileUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              {selected.displayName ? `${selected.displayName} · ` : ''}{selected.handle} ↗
            </a>
            {selected.rank && <Badge tone="blue">{selected.rank}</Badge>}
            {selected.lastSyncedAt && <span>synced {selected.lastSyncedAt.toLocaleString()}</span>}
            {selected.syncError && <span className="text-red-300">last sync: {selected.syncError}</span>}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Current rating" value={selected.rating ?? '—'} />
            <StatCard label="Maximum rating" value={selected.maxRating ?? '—'} />
            <StatCard label="Problems solved" value={analytics.solved} hint={`${analytics.attempted} attempted`} />
            <StatCard label="Solve rate" value={`${Math.round(analytics.solveRate * 100)}%`} />
            <StatCard label="Average solved" value={analytics.averageSolvedRating ?? '—'} hint={`${analytics.ratedSolved} rated problems`} />
            <StatCard label="Hardest solved" value={analytics.maxSolvedRating ?? '—'} />
          </div>

          <Section title="Accepted-problem activity">
            <Card>
              <ActivityHeatmap days={analytics.heatmap} unit="accepted problems" thresholds={[1, 2, 4]} />
            </Card>
          </Section>

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Solved by problem rating">
              <Card>
                <Bars
                  data={analytics.ratingBuckets.map((bucket) => ({
                    label: bucket.rating,
                    value: bucket.solved,
                    tooltip: `${bucket.rating}: ${bucket.solved} solved / ${bucket.attempted} attempted (${bucket.successPct}%)`,
                  }))}
                  color="#eab308"
                  height={150}
                />
                <div className="mt-3 grid grid-cols-4 gap-1 text-[11px]">
                  <span className="text-muted">rating</span><span className="text-right text-muted">attempted</span><span className="text-right text-muted">solved</span><span className="text-right text-muted">rate</span>
                  {analytics.ratingBuckets.map((bucket) => (
                    <div key={bucket.rating} className="contents">
                      <span>{bucket.rating}</span><span className="text-right tabular-nums">{bucket.attempted}</span><span className="text-right tabular-nums">{bucket.solved}</span><span className="text-right tabular-nums">{bucket.successPct}%</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            <Section title="Contest rating trend">
              <Card>
                <MetricLine data={analytics.ratingTrend} color="#a78bfa" />
                <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
                  <span><strong className="text-foreground">{analytics.contests}</strong> rated contests</span>
                  <span>best rank <strong className="text-foreground">{analytics.bestContestRank ?? '—'}</strong></span>
                  <span>average rank <strong className="text-foreground">{analytics.averageContestRank ?? '—'}</strong></span>
                </div>
              </Card>
            </Section>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Strongest tags">
              <Card className="p-0">
                {analytics.tagStats.length === 0 ? (
                  <div className="p-4 text-[12px] text-muted">No tagged solved problems yet.</div>
                ) : (
                  <div className="divide-y divide-line">
                    {analytics.tagStats.map((tag, index) => (
                      <div key={tag.tag} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                        <span className="w-5 text-muted">{index + 1}</span>
                        <span className="flex-1">{tag.tag}</span>
                        <span className="tabular-nums text-muted">{tag.solved} solved</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Section>

            <Section title="Recent accepted problems">
              <Card className="p-0">
                {recentSolved.size === 0 ? (
                  <div className="p-4 text-[12px] text-muted">No accepted submissions found.</div>
                ) : (
                  <div className="divide-y divide-line">
                    {[...recentSolved.values()].map(({ problem, submittedAt }) => (
                      <div key={codeforcesProblemKey(problem)} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                        <span className="w-8 font-medium text-accent">{problem.index}</span>
                        <span className="min-w-0 flex-1 truncate">{problem.name}</span>
                        <span className="tabular-nums text-muted">{problem.rating ?? 'unrated'}</span>
                        <span className="hidden text-muted sm:inline">{submittedAt.toISOString().slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Section>
          </div>

          {ratingChanges.length > 0 && (
            <Section title="Recent rated contests">
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-line text-muted">
                    <tr><th className="px-3 py-2">Contest</th><th className="px-3 py-2 text-right">Rank</th><th className="px-3 py-2 text-right">Rating</th><th className="px-3 py-2 text-right">Δ</th><th className="px-3 py-2 text-right">Date</th></tr>
                  </thead>
                  <tbody>
                    {[...ratingChanges].reverse().slice(0, 12).map((change) => {
                      const delta = change.newRating - change.oldRating;
                      return (
                        <tr key={change.id} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2">{change.contestName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{change.contestRank}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{change.newRating}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${delta >= 0 ? 'text-green-300' : 'text-red-300'}`}>{delta >= 0 ? '+' : ''}{delta}</td>
                          <td className="px-3 py-2 text-right text-muted">{change.updatedAt.toISOString().slice(0, 10)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </Section>
          )}
        </>
      )}
    </>
  );
}
