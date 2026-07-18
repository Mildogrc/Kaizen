export interface WordMilestoneState {
  targetValue: number | null;
  completedAt: Date | null;
}

export interface VocabGoalState {
  targetValue: number | null;
  status: string;
}

export function levelBandProgressPercent(
  currentValue: number,
  targetValue?: number,
  previousTargetValue = 0,
): number {
  if (!targetValue || targetValue <= previousTargetValue) return 0;
  const progressWithinLevel = Math.max(0, currentValue - previousTargetValue);
  const levelSize = targetValue - previousTargetValue;
  return Math.min(100, (progressWithinLevel / levelSize) * 100);
}

export function crossedWordMilestoneIndexes(
  milestones: WordMilestoneState[],
  knownWordLowerBound: number,
): number[] {
  return milestones.flatMap((milestone, index) =>
    milestone.completedAt === null &&
    milestone.targetValue !== null &&
    milestone.targetValue <= knownWordLowerBound
      ? [index]
      : [],
  );
}

export function hasCompletedActiveVocabGoal(
  goals: VocabGoalState[],
  knownWordLowerBound: number,
): boolean {
  return goals.some(
    (goal) =>
      goal.status === 'ACTIVE' &&
      goal.targetValue !== null &&
      goal.targetValue <= knownWordLowerBound,
  );
}
