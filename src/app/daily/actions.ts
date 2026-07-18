'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { meditationConfiguration } from '@/lib/app-settings';

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function setMeditationComplete(complete: boolean) {
  const { start, end } = todayBounds();
  if (complete) {
    const existing = await prisma.studySession.findFirst({ where: { mode: 'meditation', date: { gte: start, lt: end } } });
    const user = await prisma.user.findFirst({ select: { settings: true } });
    const configuration = meditationConfiguration(user?.settings);
    if (existing) {
      await prisma.studySession.update({ where: { id: existing.id }, data: { durationMin: configuration.sessionMinutes, stats: { complete: true } } });
    } else {
      await prisma.studySession.create({ data: { mode: 'meditation', date: new Date(), durationMin: configuration.sessionMinutes, stats: { complete: true } } });
    }
  } else {
    await prisma.studySession.deleteMany({ where: { mode: 'meditation', date: { gte: start, lt: end } } });
  }
  revalidatePath('/daily');
  revalidatePath('/analytics');
}
