'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getKanjiRepairDashboard } from '@/lib/kanji-repair-data';
import { kanjiRepairPerformanceSnapshot } from '@/lib/kanji-repair';

export async function completeKanjiRepairAction(formData: FormData) {
  const kanji = String(formData.get('kanji') ?? '').trim();
  if (![...kanji.matchAll(/\p{Script=Han}/gu)].length || [...kanji].length !== 1) return;

  const now = new Date();
  const dashboard = await getKanjiRepairDashboard(now);
  const candidate = dashboard.target;
  if (!dashboard.userId || !candidate || candidate.entry.kanji !== kanji) return;
  const cooldownUntil = new Date(now);
  cooldownUntil.setDate(cooldownUntil.getDate() + dashboard.configuration.cooldownDays);
  const performanceAtRepair = JSON.parse(JSON.stringify(kanjiRepairPerformanceSnapshot(candidate)));

  await prisma.kanjiRepairState.upsert({
    where: { userId_kanji: { userId: dashboard.userId, kanji } },
    create: {
      userId: dashboard.userId,
      kanji,
      lastRepairedAt: now,
      cooldownUntil,
      repairCount: 1,
      lastRepairScore: candidate.score,
      performanceAtRepair,
    },
    update: {
      lastRepairedAt: now,
      cooldownUntil,
      repairCount: { increment: 1 },
      lastRepairScore: candidate.score,
      performanceAtRepair,
    },
  });
  revalidatePath('/japanese/kanji-repair');
  revalidatePath('/japanese');
}
