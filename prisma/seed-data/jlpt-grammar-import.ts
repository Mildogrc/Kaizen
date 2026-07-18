import fs from 'node:fs/promises';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { grammarSourceKey, parseJlptGrammarCsv, type JlptLevel } from '../../src/lib/jlpt-grammar';

const LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];

export async function importJlptGrammar(prisma: PrismaClient) {
  const course = await prisma.course.findUniqueOrThrow({ where: { slug: 'japanese' } });
  const schema = await prisma.contentSchema.findUniqueOrThrow({
    where: { slug: 'japanese-grammar' },
    include: { versions: { where: { isActive: true }, orderBy: { version: 'desc' }, take: 1 } },
  });
  const version = schema.versions[0];
  if (!version) throw new Error('Japanese grammar schema has no active version.');
  let source = await prisma.source.findFirst({ where: { name: 'JLPT Grammar CSV curriculum' } });
  source ??= await prisma.source.create({
    data: {
      name: 'JLPT Grammar CSV curriculum',
      type: 'spreadsheet',
      metadata: { levels: LEVELS, newGrammarPerWeek: 5, sourceProgressIgnored: true },
    },
  });

  let curriculumOrder = 0;
  let created = 0;
  let updated = 0;
  const byLevel: Record<string, number> = {};
  for (const level of LEVELS) {
    const fileUrl = new URL(`./jlpt-grammar/${level}.csv`, import.meta.url);
    const rows = parseJlptGrammarCsv(await fs.readFile(fileUrl, 'utf8'), level);
    byLevel[level] = rows.length;
    for (const row of rows) {
      const sourceKey = grammarSourceKey(row);
      const existing = await prisma.learningItem.findUnique({
        where: { courseId_itemType_sourceKey: { courseId: course.id, itemType: schema.itemType, sourceKey } },
        select: { id: true },
      });
      const data = {
        pattern: row.pattern,
        meaning: row.meaning,
        jlptLevel: row.jlptLevel,
        examples: row.exampleJapanese && row.exampleEnglish ? [`${row.exampleJapanese} / ${row.exampleEnglish}`] : [],
        notes: row.relatedKanji ? `Related kanji/form: ${row.relatedKanji}` : undefined,
      };
      await prisma.learningItem.upsert({
        where: { courseId_itemType_sourceKey: { courseId: course.id, itemType: schema.itemType, sourceKey } },
        create: {
          courseId: course.id,
          schemaId: schema.id,
          schemaVersionId: version.id,
          itemType: schema.itemType,
          sourceId: source.id,
          sourceKey,
          data,
          grammarProgress: { create: { curriculumOrder } },
        },
        update: {
          schemaId: schema.id,
          schemaVersionId: version.id,
          sourceId: source.id,
          data,
          grammarProgress: {
            upsert: {
              create: { curriculumOrder },
              update: { curriculumOrder },
            },
          },
        },
      });
      if (existing) updated++;
      else created++;
      curriculumOrder++;
    }
  }
  return { created, updated, total: curriculumOrder, byLevel };
}
