'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { japaneseAdaptiveAnkiConfiguration, japaneseGrammarConfiguration, japaneseKanjiRepairConfiguration, mandarinBlueprintConfiguration, meditationConfiguration, speedReadingConfiguration } from '@/lib/app-settings';
import { reconcileAdaptiveAnkiAfterSync, resetAdaptiveAnkiController } from '@/lib/adaptive-anki-service';
import {
  configuredMathLongTermTargetSlugs,
  configuredMathTargetSlug,
  mathMetadataWithLongTermTargets,
  mathMetadataWithTarget,
} from '@/lib/math-goals';

export async function updateMathGoal(formData: FormData) {
  const targetSlug = String(formData.get('targetSlug') ?? '').trim();
  const [course, roadmap] = await Promise.all([
    prisma.course.findUnique({ where: { slug: 'math' }, select: { id: true, metadata: true } }),
    prisma.roadmap.findUnique({ where: { slug: 'math-roadmap' }, include: { nodes: { orderBy: { order: 'asc' } } } }),
  ]);
  if (!course || !roadmap) return;
  const longTermSlugs = configuredMathLongTermTargetSlugs(course.metadata, roadmap.nodes);
  const target = roadmap.nodes.find((node) => node.slug === targetSlug && longTermSlugs.includes(node.slug));
  if (!target) return;
  const currentGoal = await prisma.courseGoal.findFirst({ where: { courseId: course.id, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
  const goalData = { title: `Path to ${target.title}`, description: `Current roadmap path toward ${target.title}.`, goalType: 'roadmap_target' };
  await prisma.$transaction([
    prisma.course.update({ where: { id: course.id }, data: { metadata: JSON.parse(JSON.stringify(mathMetadataWithTarget(course.metadata, target.slug))) } }),
    currentGoal
      ? prisma.courseGoal.update({ where: { id: currentGoal.id }, data: goalData })
      : prisma.courseGoal.create({ data: { courseId: course.id, ...goalData, status: 'ACTIVE' } }),
  ]);
  revalidatePath('/configurations');
  revalidatePath('/math');
  revalidatePath('/');
  redirect('/configurations?section=math');
}

export async function updateMathLongTermGoal(formData: FormData) {
  const intent = String(formData.get('intent') ?? '');
  const targetSlug = String(formData.get('targetSlug') ?? '').trim();
  const [course, roadmap] = await Promise.all([
    prisma.course.findUnique({ where: { slug: 'math' }, select: { id: true, metadata: true } }),
    prisma.roadmap.findUnique({ where: { slug: 'math-roadmap' }, include: { nodes: { orderBy: { order: 'asc' } } } }),
  ]);
  if (!course || !roadmap) return;

  const currentGoal = await prisma.courseGoal.findFirst({ where: { courseId: course.id, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
  const currentSlugs = configuredMathLongTermTargetSlugs(course.metadata, roadmap.nodes);
  const validTarget = roadmap.nodes.find((node) => node.slug === targetSlug);
  let nextSlugs = currentSlugs;
  if (intent === 'add' && validTarget && !currentSlugs.includes(validTarget.slug)) {
    nextSlugs = [...currentSlugs, validTarget.slug];
  }
  if (intent === 'remove' && currentSlugs.length > 1 && currentSlugs.includes(targetSlug)) {
    nextSlugs = currentSlugs.filter((slug) => slug !== targetSlug);
  }
  if (nextSlugs === currentSlugs) redirect('/configurations?section=math');

  const configuredTargets = roadmap.nodes.filter((node) => nextSlugs.includes(node.slug));
  const previousCurrentSlug = configuredMathTargetSlug(course.metadata, roadmap.nodes, currentGoal?.title);
  const nextCurrentSlug = previousCurrentSlug && nextSlugs.includes(previousCurrentSlug) ? previousCurrentSlug : nextSlugs[0];
  const nextCurrent = configuredTargets.find((target) => target.slug === nextCurrentSlug);
  if (!nextCurrent) redirect('/configurations?section=math');

  const metadata = mathMetadataWithTarget(
    mathMetadataWithLongTermTargets(course.metadata, nextSlugs),
    nextCurrent.slug,
  );
  const goalData = { title: `Path to ${nextCurrent.title}`, description: `Current roadmap path toward ${nextCurrent.title}.`, goalType: 'roadmap_target' };
  await prisma.$transaction([
    prisma.course.update({ where: { id: course.id }, data: { metadata: JSON.parse(JSON.stringify(metadata)) } }),
    currentGoal
      ? prisma.courseGoal.update({ where: { id: currentGoal.id }, data: goalData })
      : prisma.courseGoal.create({ data: { courseId: course.id, ...goalData, status: 'ACTIVE' } }),
  ]);
  revalidatePath('/configurations');
  revalidatePath('/math');
  revalidatePath('/');
  redirect('/configurations?section=math');
}

export async function updateSpeedReadingConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const configuration = speedReadingConfiguration({
    speedReading: {
      mode: String(formData.get('mode') ?? 'RSVP'),
      wpm: formData.get('wpm'),
      chunkSize: formData.get('chunkSize'),
      fontSize: formData.get('fontSize'),
      sessionMinutes: formData.get('sessionMinutes'),
      comprehensionThreshold: formData.get('comprehensionThreshold'),
      punctuationPause: formData.get('punctuationPause') === 'on',
      category: String(formData.get('category') ?? 'all'),
      difficulty: String(formData.get('difficulty') ?? 'all'),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, speedReading: configuration })) },
  });
  revalidatePath('/configurations');
  revalidatePath('/speed-reading');
}

export async function updateMandarinBlueprintConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const configuration = mandarinBlueprintConfiguration({
    mandarinBlueprint: {
      characterDeckName: formData.get('characterDeckName'),
      reversedCharacterDeckName: formData.get('reversedCharacterDeckName'),
      wordDeckName: formData.get('wordDeckName'),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, mandarinBlueprint: configuration })) } });
  revalidatePath('/configurations');
  revalidatePath('/chinese/mandarin-blueprint');
}

export async function updateMeditationConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const configuration = meditationConfiguration({
    meditation: {
      sessionMinutes: formData.get('sessionMinutes'),
      targetDaysPerWeek: formData.get('targetDaysPerWeek'),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, meditation: configuration })) },
  });
  revalidatePath('/configurations');
  revalidatePath('/daily');
  revalidatePath('/analytics');
}

export async function updateJapaneseGrammarConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const configuration = japaneseGrammarConfiguration({
    japaneseGrammar: {
      newPointsPerBatch: formData.get('newPointsPerBatch'),
      newBatchIntervalDays: formData.get('newBatchIntervalDays'),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, japaneseGrammar: configuration })) },
  });
  revalidatePath('/configurations');
  revalidatePath('/japanese/grammar');
  revalidatePath('/daily');
}

export async function updateJapaneseKanjiRepairConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const configuration = japaneseKanjiRepairConfiguration({
    japaneseKanjiRepair: {
      useVocabularyPerformance: formData.get('useVocabularyPerformance') === 'on',
      cooldownDays: formData.get('cooldownDays'),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, japaneseKanjiRepair: configuration })) },
  });
  revalidatePath('/configurations');
  revalidatePath('/japanese/kanji-repair');
}

export async function updateJapaneseAdaptiveAnkiConfiguration(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const previous = japaneseAdaptiveAnkiConfiguration(user.settings);
  const requestedMappingIds = new Set(formData.getAll('adaptiveMappingIds').map(String));
  const configuration = japaneseAdaptiveAnkiConfiguration({
    japaneseAdaptiveAnki: {
      enabled: formData.get('enabled') === 'on',
      startingBudget: formData.get('startingBudget'),
      maximumBudget: formData.get('maximumBudget'),
      coldStartProtection: formData.get('coldStartProtection') === 'on',
      targetReviewMinutes: formData.get('targetReviewMinutes'),
      ankiDayStartHour: formData.get('ankiDayStartHour'),
    },
  });
  const japaneseMappings = await prisma.ankiDeckMapping.findMany({
    where: { course: { slug: 'japanese' } },
    select: { id: true, deckName: true },
  });
  const selectedMappingIds = japaneseMappings
    .filter((mapping) => requestedMappingIds.has(mapping.id))
    .map((mapping) => mapping.id);
  if (configuration.enabled && selectedMappingIds.length === 0) {
    const likelyVocabularyDecks = japaneseMappings.filter((mapping) => !/(?:rtk|kanji)/i.test(mapping.deckName));
    if (likelyVocabularyDecks.length === 1) selectedMappingIds.push(likelyVocabularyDecks[0].id);
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: user.id },
      data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, japaneseAdaptiveAnki: configuration })) },
    });
    await transaction.ankiDeckMapping.updateMany({
      where: { course: { slug: 'japanese' } },
      data: { adaptiveNewCards: false },
    });
    if (selectedMappingIds.length > 0) {
      await transaction.ankiDeckMapping.updateMany({
        where: { id: { in: selectedMappingIds }, course: { slug: 'japanese' } },
        data: { adaptiveNewCards: true },
      });
    }
  });
  if (configuration.enabled && !previous.enabled) {
    await resetAdaptiveAnkiController(user.id);
  }
  await reconcileAdaptiveAnkiAfterSync().catch(() => {});
  revalidatePath('/configurations');
  revalidatePath('/anki');
}

export async function resetJapaneseAdaptiveAnki(formData: FormData) {
  if (formData.get('confirmReset') !== 'on') return;
  const user = await prisma.user.findFirst();
  if (!user) return;
  await resetAdaptiveAnkiController(user.id);
  await reconcileAdaptiveAnkiAfterSync().catch(() => {});
  revalidatePath('/configurations');
  revalidatePath('/anki');
}
