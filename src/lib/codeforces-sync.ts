import { prisma } from './db';
import { parseCodeforcesHandle } from './codeforces';

const API_BASE = 'https://codeforces.com/api';
const API_DELAY_MS = 2100;

interface ApiEnvelope<T> {
  status: 'OK' | 'FAILED';
  result?: T;
  comment?: string;
}

interface ApiUser {
  handle: string;
  firstName?: string;
  lastName?: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  avatar?: string;
  contribution?: number;
}

interface ApiSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds?: number;
  problem: {
    contestId?: number;
    problemsetName?: string;
    index: string;
    name: string;
    rating?: number;
    tags: string[];
  };
  author?: { participantType?: string };
  programmingLanguage?: string;
  verdict?: string;
  timeConsumedMillis?: number;
  memoryConsumedBytes?: number;
}

interface ApiRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

async function requestCodeforces<T>(method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Kaizen learning dashboard' },
  });
  if (!response.ok) throw new Error(`Codeforces returned HTTP ${response.status}.`);
  const body = (await response.json()) as ApiEnvelope<T>;
  if (body.status !== 'OK' || body.result === undefined) {
    throw new Error(body.comment ?? 'Codeforces API request failed.');
  }
  return body.result;
}

const waitForRateLimit = () => new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));

export async function syncCodeforcesProfile(input: string) {
  const requestedHandle = parseCodeforcesHandle(input);
  const [user] = await requestCodeforces<ApiUser[]>('user.info', { handles: requestedHandle });
  if (!user) throw new Error('Codeforces did not return that user.');

  await waitForRateLimit();
  const submissions = await requestCodeforces<ApiSubmission[]>('user.status', {
    handle: user.handle,
    from: '1',
    count: '10000',
  });

  await waitForRateLimit();
  const ratingChanges = await requestCodeforces<ApiRatingChange[]>('user.rating', { handle: user.handle });

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  const profile = await prisma.codeforcesProfile.upsert({
    where: { handle: user.handle },
    create: {
      handle: user.handle,
      profileUrl: `https://codeforces.com/profile/${encodeURIComponent(user.handle)}`,
      displayName,
      rating: user.rating,
      maxRating: user.maxRating,
      rank: user.rank,
      maxRank: user.maxRank,
      avatarUrl: user.avatar,
      contribution: user.contribution,
      lastSyncedAt: new Date(),
    },
    update: {
      profileUrl: `https://codeforces.com/profile/${encodeURIComponent(user.handle)}`,
      displayName,
      rating: user.rating,
      maxRating: user.maxRating,
      rank: user.rank,
      maxRank: user.maxRank,
      avatarUrl: user.avatar,
      contribution: user.contribution,
      lastSyncedAt: new Date(),
      syncError: null,
    },
  });

  await prisma.$transaction([
    prisma.codeforcesSubmission.createMany({
      data: submissions.map((submission) => ({
        profileId: profile.id,
        codeforcesId: BigInt(submission.id),
        contestId: submission.contestId ?? submission.problem.contestId,
        problemIndex: submission.problem.index,
        problemName: submission.problem.name,
        problemRating: submission.problem.rating,
        problemTags: submission.problem.tags,
        verdict: submission.verdict,
        participantType: submission.author?.participantType,
        programmingLanguage: submission.programmingLanguage,
        submittedAt: new Date(submission.creationTimeSeconds * 1000),
        timeConsumedMillis: submission.timeConsumedMillis,
        memoryConsumedBytes:
          submission.memoryConsumedBytes == null ? undefined : BigInt(submission.memoryConsumedBytes),
      })),
      skipDuplicates: true,
    }),
    prisma.codeforcesRatingChange.createMany({
      data: ratingChanges.map((change) => ({
        profileId: profile.id,
        contestId: change.contestId,
        contestName: change.contestName,
        contestRank: change.rank,
        oldRating: change.oldRating,
        newRating: change.newRating,
        updatedAt: new Date(change.ratingUpdateTimeSeconds * 1000),
      })),
      skipDuplicates: true,
    }),
  ]);

  return {
    profileId: profile.id,
    handle: profile.handle,
    submissions: submissions.length,
    contests: ratingChanges.length,
  };
}
