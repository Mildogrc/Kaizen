export interface MathTarget {
  slug: string;
  title: string;
  isTarget?: boolean;
}

function metadataRoot(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

export function configuredMathLongTermTargetSlugs(metadata: unknown, targets: MathTarget[]): string[] {
  const root = metadataRoot(metadata);
  const available = new Set(targets.map((target) => target.slug));
  const saved = Array.isArray(root.longTermTargetSlugs)
    ? [...new Set(root.longTermTargetSlugs.filter((slug): slug is string => typeof slug === 'string' && available.has(slug)))]
    : [];
  if (saved.length) return saved;
  return targets.filter((target) => target.isTarget !== false).map((target) => target.slug);
}

export function configuredMathTargetSlug(metadata: unknown, targets: MathTarget[], activeGoalTitle?: string | null): string | null {
  const root = metadataRoot(metadata);
  const saved = typeof root.currentTargetSlug === 'string' ? root.currentTargetSlug : null;
  if (saved && targets.some((target) => target.slug === saved)) return saved;
  if (activeGoalTitle) {
    const match = targets.find((target) => activeGoalTitle.toLowerCase().includes(target.title.toLowerCase()));
    if (match) return match.slug;
  }
  return targets.find((target) => target.slug === 'iwasawa-theory')?.slug ?? targets[0]?.slug ?? null;
}

export function mathMetadataWithTarget(metadata: unknown, currentTargetSlug: string): Record<string, unknown> {
  const root = metadataRoot(metadata);
  return { ...root, currentTargetSlug };
}

export function mathMetadataWithLongTermTargets(metadata: unknown, longTermTargetSlugs: string[]): Record<string, unknown> {
  const root = metadataRoot(metadata);
  return { ...root, longTermTargetSlugs: [...new Set(longTermTargetSlugs)] };
}
