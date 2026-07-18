import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { recomputeKnownWordStats } from '../src/lib/known-words-sync';

recomputeKnownWordStats()
  .then((stats) => console.log('Known-word progression refreshed:', stats))
  .finally(() => prisma.$disconnect());
