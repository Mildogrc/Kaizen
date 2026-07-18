import { describe, expect, it } from 'vitest';
import { configuredMathTargetSlug, mathMetadataWithTarget } from '../src/lib/math-goals';

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
});
