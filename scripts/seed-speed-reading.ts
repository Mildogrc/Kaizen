import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ensureStarterSpeedReadingPassage } from '../prisma/seed-data/speed-reading';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

ensureStarterSpeedReadingPassage(prisma)
  .then((passage) => console.log(`Starter speed-reading passage ready: ${passage.title} (${passage.wordCount} words)`))
  .finally(() => prisma.$disconnect());
