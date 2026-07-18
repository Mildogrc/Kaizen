const DAY_MS = 86_400_000;

export interface CodeforcesProblem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

export interface CodeforcesSubmissionRow {
  codeforcesId: bigint | number | string;
  submittedAt: Date;
  verdict: string | null;
  problem: CodeforcesProblem;
}

export interface CodeforcesRatingRow {
  contestId: number;
  contestName: string;
  contestRank: number;
  oldRating: number;
  newRating: number;
  updatedAt: Date;
}

export interface CodeforcesRatingBucket {
  rating: string;
  attempted: number;
  solved: number;
  successPct: number;
}

export interface CodeforcesAnalytics {
  attempted: number;
  solved: number;
  solveRate: number;
  ratedSolved: number;
  averageSolvedRating: number | null;
  maxSolvedRating: number | null;
  ratingBuckets: CodeforcesRatingBucket[];
  tagStats: { tag: string; solved: number }[];
  heatmap: { date: string; reviews: number }[];
  ratingTrend: { label: string; value: number; tooltip: string }[];
  contests: number;
  averageContestRank: number | null;
  bestContestRank: number | null;
}

export function parseCodeforcesHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a Codeforces profile URL or handle.');

  let handle = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('That is not a valid URL.');
    }
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'codeforces.com' && hostname !== 'mirror.codeforces.com') {
      throw new Error('Use a codeforces.com profile URL.');
    }
    const match = url.pathname.match(/^\/profile\/([^/]+)\/?$/i);
    if (!match) throw new Error('Use a URL like https://codeforces.com/profile/tourist.');
    handle = decodeURIComponent(match[1]);
  }

  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(handle)) {
    throw new Error('The Codeforces handle format is invalid.');
  }
  return handle;
}

export function codeforcesProblemKey(problem: CodeforcesProblem): string {
  const contest = problem.contestId ?? problem.problemsetName ?? 'unknown';
  return `${contest}:${problem.index}`;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function analyzeCodeforces(
  submissions: CodeforcesSubmissionRow[],
  ratingChanges: CodeforcesRatingRow[],
  now = new Date(),
): CodeforcesAnalytics {
  const attemptedProblems = new Map<string, CodeforcesProblem>();
  const solvedProblems = new Map<string, { problem: CodeforcesProblem; solvedAt: Date }>();

  for (const submission of [...submissions].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())) {
    const key = codeforcesProblemKey(submission.problem);
    attemptedProblems.set(key, submission.problem);
    if (submission.verdict === 'OK' && !solvedProblems.has(key)) {
      solvedProblems.set(key, { problem: submission.problem, solvedAt: submission.submittedAt });
    }
  }

  const attemptedByRating = new Map<number, Set<string>>();
  const solvedByRating = new Map<number, Set<string>>();
  for (const [key, problem] of attemptedProblems) {
    if (problem.rating == null) continue;
    const bucket = attemptedByRating.get(problem.rating) ?? new Set<string>();
    bucket.add(key);
    attemptedByRating.set(problem.rating, bucket);
  }
  for (const [key, solved] of solvedProblems) {
    if (solved.problem.rating == null) continue;
    const bucket = solvedByRating.get(solved.problem.rating) ?? new Set<string>();
    bucket.add(key);
    solvedByRating.set(solved.problem.rating, bucket);
  }

  const ratings = [...new Set([...attemptedByRating.keys(), ...solvedByRating.keys()])].sort((a, b) => a - b);
  const ratingBuckets = ratings.map((rating) => {
    const attempted = attemptedByRating.get(rating)?.size ?? 0;
    const solved = solvedByRating.get(rating)?.size ?? 0;
    return {
      rating: String(rating),
      attempted,
      solved,
      successPct: attempted === 0 ? 0 : Math.round((solved / attempted) * 100),
    };
  });

  const solvedRatings = [...solvedProblems.values()]
    .map(({ problem }) => problem.rating)
    .filter((rating): rating is number => rating != null);
  const tagCounts = new Map<string, number>();
  for (const { problem } of solvedProblems.values()) {
    for (const tag of problem.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const heatCounts = new Map<string, number>();
  for (const solved of solvedProblems.values()) {
    const key = dayKey(solved.solvedAt);
    heatCounts.set(key, (heatCounts.get(key) ?? 0) + 1);
  }
  const heatStart = startOfDay(new Date(startOfDay(now).getTime() - 364 * DAY_MS));
  const heatmap = Array.from({ length: 365 }, (_, index) => {
    const date = dayKey(new Date(heatStart.getTime() + index * DAY_MS));
    return { date, reviews: heatCounts.get(date) ?? 0 };
  });

  const sortedRatings = [...ratingChanges].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  return {
    attempted: attemptedProblems.size,
    solved: solvedProblems.size,
    solveRate: attemptedProblems.size === 0 ? 0 : solvedProblems.size / attemptedProblems.size,
    ratedSolved: solvedRatings.length,
    averageSolvedRating:
      solvedRatings.length === 0
        ? null
        : Math.round(solvedRatings.reduce((sum, rating) => sum + rating, 0) / solvedRatings.length),
    maxSolvedRating: solvedRatings.length === 0 ? null : Math.max(...solvedRatings),
    ratingBuckets,
    tagStats: [...tagCounts.entries()]
      .map(([tag, solved]) => ({ tag, solved }))
      .sort((a, b) => b.solved - a.solved || a.tag.localeCompare(b.tag))
      .slice(0, 12),
    heatmap,
    ratingTrend: sortedRatings.map((change) => ({
      label: dayKey(change.updatedAt),
      value: change.newRating,
      tooltip: `${change.contestName}: ${change.newRating} (${change.newRating - change.oldRating >= 0 ? '+' : ''}${change.newRating - change.oldRating}), rank ${change.contestRank}`,
    })),
    contests: sortedRatings.length,
    averageContestRank:
      sortedRatings.length === 0
        ? null
        : Math.round(sortedRatings.reduce((sum, change) => sum + change.contestRank, 0) / sortedRatings.length),
    bestContestRank:
      sortedRatings.length === 0 ? null : Math.min(...sortedRatings.map((change) => change.contestRank)),
  };
}
