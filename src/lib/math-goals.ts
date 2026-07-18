export interface MathTarget {
  slug: string;
  title: string;
}

export function configuredMathTargetSlug(metadata: unknown, targets: MathTarget[], activeGoalTitle?: string | null): string | null {
  const root = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  const saved = typeof root.currentTargetSlug === 'string' ? root.currentTargetSlug : null;
  if (saved && targets.some((target) => target.slug === saved)) return saved;
  if (activeGoalTitle) {
    const match = targets.find((target) => activeGoalTitle.toLowerCase().includes(target.title.toLowerCase()));
    if (match) return match.slug;
  }
  return targets.find((target) => target.slug === 'iwasawa-theory')?.slug ?? targets[0]?.slug ?? null;
}

export function mathMetadataWithTarget(metadata: unknown, currentTargetSlug: string): Record<string, unknown> {
  const root = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  return { ...root, currentTargetSlug };
}
