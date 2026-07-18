import { describe, expect, it } from 'vitest';
import {
  forecast,
  health,
  leeches,
  projections,
  retention,
  reviewsPerDay,
  streaks,
  type LogRow,
  type SnapshotRow,
} from '../src/lib/anki-analytics';
import { buildLeechLessonPlanMd } from '../src/lib/leech-prompt';

const NOW = new Date('2026-07-16T15:00:00');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

function log(partial: Partial<LogRow>): LogRow {
  return {
    ankiCardId: '1',
    reviewedAt: NOW,
    rating: 3,
    intervalBeforeDays: 10,
    intervalAfterDays: 25,
    timeMs: 6000,
    ...partial,
  };
}

function snap(partial: Partial<SnapshotRow>): SnapshotRow {
  return {
    ankiCardId: '1',
    front: '你好',
    back: 'nǐ hǎo — hello',
    state: 'YOUNG',
    intervalDays: 10,
    ease: 2.5,
    dueAt: NOW,
    reps: 3,
    lapses: 0,
    isLeech: false,
    ...partial,
  };
}

describe('reviewsPerDay', () => {
  it('buckets reviews into trailing calendar days with zero-filled gaps', () => {
    const logs = [log({ reviewedAt: at(0) }), log({ reviewedAt: at(0) }), log({ reviewedAt: at(2) })];
    const series = reviewsPerDay(logs, 4, NOW);
    expect(series).toHaveLength(4);
    expect(series[3].reviews).toBe(2); // today
    expect(series[2].reviews).toBe(0); // yesterday
    expect(series[1].reviews).toBe(1); // two days ago
    expect(series[3].minutes).toBe(0); // 12s rounds to 0 minutes
  });
});

describe('streaks', () => {
  it('computes current streak allowing a not-yet-studied today', () => {
    const logs = [1, 2, 3].map((d) => log({ reviewedAt: at(d) }));
    expect(streaks(logs, NOW).current).toBe(3);
  });

  it('counts today when studied and breaks across gaps', () => {
    const logs = [0, 1, 3, 4, 5, 6].map((d) => log({ reviewedAt: at(d) }));
    const result = streaks(logs, NOW);
    expect(result.current).toBe(2); // today + yesterday, gap at day 2
    expect(result.best).toBe(4); // days 3-6
  });

  it('returns 0 current when the last review is older than yesterday', () => {
    expect(streaks([log({ reviewedAt: at(5) })], NOW).current).toBe(0);
  });
});

describe('retention', () => {
  it('splits pass rates by young/mature and ignores learning-stage answers', () => {
    const logs = [
      log({ intervalBeforeDays: 0, rating: 1 }), // learning: excluded
      log({ intervalBeforeDays: 5, rating: 3 }), // young pass
      log({ intervalBeforeDays: 5, rating: 1 }), // young fail
      log({ intervalBeforeDays: 30, rating: 3 }), // mature pass
      log({ intervalBeforeDays: 40, rating: 4 }), // mature pass
    ];
    const r = retention(logs);
    expect(r.reviewCount).toBe(4);
    expect(r.young).toBeCloseTo(0.5);
    expect(r.mature).toBe(1);
    expect(r.overall).toBeCloseTo(0.75);
    expect(r.lapses).toBe(1);
  });

  it('returns nulls with no review data', () => {
    expect(retention([]).overall).toBeNull();
  });
});

describe('forecast', () => {
  it('buckets due cards per day and rolls overdue into today', () => {
    const snaps = [
      snap({ dueAt: at(3) }), // overdue
      snap({ dueAt: NOW }),
      snap({ dueAt: new Date(NOW.getTime() + 1 * DAY) }),
      snap({ dueAt: new Date(NOW.getTime() + 1 * DAY) }),
      snap({ state: 'NEW', dueAt: null }), // unscheduled: excluded
      snap({ state: 'SUSPENDED', dueAt: NOW }), // suspended: excluded
    ];
    const f = forecast(snaps, 3, NOW);
    expect(f.overdue).toBe(1);
    expect(f.days[0].due).toBe(2); // today + overdue
    expect(f.days[1].due).toBe(2);
    expect(f.days[2].due).toBe(0);
  });
});

describe('health', () => {
  it('counts states and buckets intervals', () => {
    const snaps = [
      snap({ state: 'NEW', intervalDays: 0 }),
      snap({ state: 'MATURE', intervalDays: 400, ease: 2.8 }),
      snap({ state: 'YOUNG', intervalDays: 10, ease: 1.4 }),
    ];
    const h = health(snaps);
    expect(h.states.NEW).toBe(1);
    expect(h.states.MATURE).toBe(1);
    expect(h.intervalBuckets.find((b) => b.label === '1y+')!.count).toBe(1);
    expect(h.intervalBuckets.find((b) => b.label === '1w–1m')!.count).toBe(1);
    expect(h.easeHistogram.find((b) => b.label === '1.3–1.7')!.count).toBe(1);
  });
});

describe('projections', () => {
  it('projects new-card completion from introduction pace', () => {
    // 2 cards introduced per day for the last 10 days.
    const logs: LogRow[] = [];
    for (let d = 0; d < 10; d++) {
      logs.push(log({ ankiCardId: `a${d}`, reviewedAt: at(d), intervalBeforeDays: 0 }));
      logs.push(log({ ankiCardId: `b${d}`, reviewedAt: at(d), intervalBeforeDays: 0 }));
    }
    const snaps = Array.from({ length: 20 }, (_, i) => snap({ ankiCardId: `new${i}`, state: 'NEW', dueAt: null }));
    const [newProjection] = projections(snaps, logs, null, NOW);
    // 20 remaining at 20/30 per day → 30 days out.
    expect(newProjection.date).toBe('2026-08-15');
    expect(newProjection.confidence).toBe('ok');
  });

  it('marks projections low-confidence with sparse data and null with zero pace', () => {
    const result = projections([snap({ state: 'NEW', dueAt: null })], [], null, NOW);
    expect(result[0].confidence).toBe('low');
    expect(result[0].date).toBeNull();
  });

  it('projects goal dates from maturation pace', () => {
    // 1 card matures per day for 15 days.
    const logs = Array.from({ length: 15 }, (_, d) =>
      log({ ankiCardId: `m${d}`, reviewedAt: at(d), intervalBeforeDays: 15, intervalAfterDays: 30 }),
    );
    const result = projections([], logs, { title: 'Reach 500 words', targetValue: 500, currentValue: 485 }, NOW);
    const goal = result.find((p) => p.label.startsWith('Goal'))!;
    // 15 remaining at 0.5/day → 30 days.
    expect(goal.date).toBe('2026-08-15');
  });
});

describe('leeches + lesson plan', () => {
  it('filters and sorts leeches, and renders the markdown prompt', () => {
    const snaps = [
      snap({ front: '把', back: 'bǎ — object marker', isLeech: true, lapses: 12 }),
      snap({ front: '的', back: 'de — possessive', isLeech: true, lapses: 9 }),
      snap({ front: '好', isLeech: false }),
    ];
    const list = leeches(snaps);
    expect(list.map((l) => l.front)).toEqual(['把', '的']);

    const md = buildLeechLessonPlanMd({ deckName: 'Refold Mandarin 1k+', courseName: 'Chinese', leeches: list });
    expect(md).toContain('lesson plan');
    expect(md).toContain('| 把 | bǎ — object marker | 12 |');
    expect(md).toContain('My leech cards (2)');
  });
});
