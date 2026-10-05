import { describe, expect, it } from 'vitest';
import {
  configuredMathLongTermTargetSlugs,
  configuredMathTargetSlug,
  mathMetadataWithLongTermTargets,
  mathMetadataWithTarget,
} from '../src/lib/math-goals';

const targets = [
  { slug: 'iwasawa-theory', title: 'Iwasawa Theory' },
  { slug: 'quantitative-finance', title: 'Quantitative Finance' },
];

describe('Math goal configuration', () => {
  it('uses saved configuration before the legacy goal title', () => {
    expect(configuredMathTargetSlug({ currentTargetSlug: 'quantitative-finance' }, targets, 'Path to Iwasawa Theory')).toBe('quantitative-finance');
  });

  it('falls back to the existing active goal and preserves metadata', () => {
    expect(configuredMathTargetSlug({}, targets, 'Path to Iwasawa Theory')).toBe('iwasawa-theory');
    expect(mathMetadataWithTarget({ keep: true }, 'quantitative-finance')).toEqual({ keep: true, currentTargetSlug: 'quantitative-finance' });
  });

  it('uses customized long-term goals and filters invalid saved slugs', () => {
    expect(configuredMathLongTermTargetSlugs(
      { longTermTargetSlugs: ['quantitative-finance', 'missing', 'quantitative-finance'] },
      targets,
    )).toEqual(['quantitative-finance']);
    expect(mathMetadataWithLongTermTargets({ keep: true }, ['iwasawa-theory', 'iwasawa-theory'])).toEqual({
      keep: true,
      longTermTargetSlugs: ['iwasawa-theory'],
    });
  });

  it('defaults to roadmap target nodes', () => {
    expect(configuredMathLongTermTargetSlugs({}, [
      { slug: 'foundation', title: 'Foundation', isTarget: false },
      { slug: 'iwasawa-theory', title: 'Iwasawa Theory', isTarget: true },
    ])).toEqual(['iwasawa-theory']);
  });
});
