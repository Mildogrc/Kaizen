'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { pushMandarinBlueprintLevel } from '@/lib/mandarin-anki';

export async function completeMandarinBlueprintLevelAction(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 88) return { ok: false, error: 'Invalid level.' };
  const row = await prisma.mandarinBlueprintLevel.findUnique({ where: { level } });
  if (!row) return { ok: false, error: 'Import the Mandarin Blueprint catalog first.' };
  await prisma.mandarinBlueprintLevel.update({ where: { level }, data: { completedAt: row.completedAt ?? new Date(), pushError: null } });
  try {
    const result = await pushMandarinBlueprintLevel(level);
    await prisma.mandarinBlueprintLevel.update({ where: { level }, data: { pushedAt: new Date(), pushError: null } });
    revalidatePath('/chinese/mandarin-blueprint');
    revalidatePath('/chinese');
    revalidatePath('/anki');
    revalidatePath('/analytics');
    return { ok: true, message: `Added ${result.added} cards; ${result.skipped} duplicates skipped.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not push this level to Anki.';
    await prisma.mandarinBlueprintLevel.update({ where: { level }, data: { pushError: message } });
    revalidatePath('/chinese/mandarin-blueprint');
    return { ok: false, error: message };
  }
}
