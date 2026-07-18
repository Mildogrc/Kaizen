'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseCodeforcesHandle } from '@/lib/codeforces';
import { syncCodeforcesProfile } from '@/lib/codeforces-sync';

export async function syncCodeforcesAction(input: string) {
  let handle: string | null = null;
  try {
    handle = parseCodeforcesHandle(input);
    const result = await syncCodeforcesProfile(handle);
    revalidatePath('/codeforces');
    return { ok: true as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codeforces sync failed.';
    if (handle) {
      await prisma.codeforcesProfile.updateMany({
        where: { handle },
        data: { syncError: message },
      });
    }
    return { ok: false as const, error: message };
  }
}
