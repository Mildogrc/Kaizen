'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { mandarinBlueprintConfiguration, meditationConfiguration, speedReadingConfiguration } from '@/lib/app-settings';
import { mathMetadataWithTarget } from '@/lib/math-goals';

export async function updateMathGoal(formData: FormData) {
  const targetSlug = String(formData.get('targetSlug') ?? '').trim();
  const [course, target] = await Promise.all([
    prisma.course.findUnique({ where: { slug: 'math' }, select: { id: true, metadata: true } }),
    prisma.roadmapNode.findFirst({ where: { slug: targetSlug, isTarget: true, roadmap: { slug: 'math-roadmap' } }, select: { slug: true, title: true } }),
  ]);
  if (!course || !target) return;
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
