// One-off: remove the in-app Flashcards (and their ReviewRecords, via
// cascade) that were created by the old .apkg import — Anki is the review
// engine for deck content now. LearningItems and the ImportBatch stay.

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const result = await prisma.flashcard.deleteMany({
    where: { metadata: { path: ['source'], equals: 'anki' } },
  });
  const remainingCards = await prisma.flashcard.count();
  const remainingItems = await prisma.learningItem.count({ where: { itemType: 'ChineseVocabularyItem' } });
  console.log(`Deleted ${result.count} anki-sourced flashcards (review records cascaded).`);
  console.log(`Remaining in-app flashcards: ${remainingCards}; Chinese vocabulary items kept: ${remainingItems}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
