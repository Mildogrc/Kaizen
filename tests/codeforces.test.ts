import { describe, expect, it } from 'vitest';
import { analyzeCodeforces, parseCodeforcesHandle } from '../src/lib/codeforces';

describe('parseCodeforcesHandle', () => {
  it('accepts a handle or profile URL', () => {
    expect(parseCodeforcesHandle('tourist')).toBe('tourist');
    expect(parseCodeforcesHandle('https://codeforces.com/profile/Benq/')).toBe('Benq');
  });

  it('rejects non-profile URLs', () => {
    expect(() => parseCodeforcesHandle('https://example.com/profile/tourist')).toThrow();
    expect(() => parseCodeforcesHandle('https://codeforces.com/contest/1')).toThrow();
  });
});

describe('analyzeCodeforces', () => {
  it('deduplicates accepted problems and groups ratings', () => {
    const problem = { contestId: 1, index: 'A', name: 'A', rating: 800, tags: ['math'] };
    const result = analyzeCodeforces(
      [
        { codeforcesId: 1, submittedAt: new Date('2026-01-01T00:00:00Z'), verdict: 'WRONG_ANSWER', problem },
        { codeforcesId: 2, submittedAt: new Date('2026-01-02T00:00:00Z'), verdict: 'OK', problem },
        { codeforcesId: 3, submittedAt: new Date('2026-01-03T00:00:00Z'), verdict: 'OK', problem },
      ],
      [],
      new Date('2026-01-03T00:00:00Z'),
    );
    expect(result.attempted).toBe(1);
    expect(result.solved).toBe(1);
    expect(result.ratingBuckets).toEqual([{ rating: '800', attempted: 1, solved: 1, successPct: 100 }]);
    expect(result.tagStats).toEqual([{ tag: 'math', solved: 1 }]);
  });
});
