import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { SEED_SCHEMAS } from './seed-data/schemas';
import { MATH_NODES, MATH_EDGES } from './seed-data/math-roadmap';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function reset() {
  // Order matters: children before parents.
  await prisma.attempt.deleteMany();
  await prisma.reviewRecord.deleteMany();
  await prisma.mistake.deleteMany();
  await prisma.flashcard.deleteMany();
  await prisma.practiceItem.deleteMany();
  await prisma.learningItem.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.contentSchemaField.deleteMany();
  await prisma.contentSchemaVersion.deleteMany();
  await prisma.contentSchema.deleteMany();
  await prisma.bookNote.deleteMany();
  await prisma.book.deleteMany();
  await prisma.roadmapEdge.deleteMany();
  await prisma.roadmapNode.deleteMany();
  await prisma.roadmap.deleteMany();
  await prisma.examObjective.deleteMany();
  await prisma.courseGoal.deleteMany();
  await prisma.examLevel.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.courseMilestone.deleteMany();
  await prisma.coursePlan.deleteMany();
  await prisma.studySession.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.source.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser() {
  await prisma.user.create({
    data: {
      email: 'rcmohan@gmail.com',
      name: 'Milind',
      settings: { dailyNewCards: 20, dailyReviewCap: 200, defaultStudyMode: 'balanced' },
    },
  });
}

async function seedCourses() {
  const courses = [
    { slug: 'japanese', name: 'Japanese', category: 'LANGUAGE', tab: 'JAPANESE', color: '#e11d48', description: 'Japanese from beginner to advanced: JLPT N5–N1, BJT, Kanji Kentei.' },
    { slug: 'chinese', name: 'Chinese', category: 'LANGUAGE', tab: 'CHINESE', color: '#dc2626', description: 'Mandarin Chinese: HSK 1 through HSK 9, simplified and traditional.' },
    { slug: 'math', name: 'Mathematics', category: 'MATH', tab: 'MATH', color: '#2563eb', description: 'School math through advanced pure and applied mathematics.' },
    { slug: 'typing', name: 'Typing', category: 'SKILL', tab: 'SKILLS', color: '#16a34a', description: 'Typing speed and accuracy: WPM, weak keys, custom drills.' },
    { slug: 'nato-alphabet', name: 'NATO Alphabet', category: 'SKILL', tab: 'SKILLS', color: '#0891b2', description: 'NATO phonetic alphabet: letter↔word recall, timed drills.' },
    { slug: 'geoguessr', name: 'GeoGuessr', category: 'SKILL', tab: 'SKILLS', color: '#ca8a04', description: 'Country identification: flags, signs, plates, bollards, scripts.' },
    { slug: 'books', name: 'Books', category: 'BOOK', tab: 'BOOKS', color: '#9333ea', description: 'Reading tracker and knowledge retention from books.' },
  ] as const;
  const map = new Map<string, string>();
  for (const c of courses) {
    const row = await prisma.course.create({ data: { ...c } });
    map.set(c.slug, row.id);
  }
  return map;
}

async function seedExams(courses: Map<string, string>) {
  // JLPT — placeholder targets, editable later.
  const jlpt = await prisma.exam.create({
    data: { courseId: courses.get('japanese')!, slug: 'jlpt', name: 'JLPT', description: 'Japanese-Language Proficiency Test, levels N5 (easiest) to N1.' },
  });
  const jlptLevels: [string, number, Record<string, number>][] = [
    ['N5', 1, { targetVocab: 800, targetKanji: 100, targetGrammar: 80 }],
    ['N4', 2, { targetVocab: 1500, targetKanji: 300, targetGrammar: 160 }],
    ['N3', 3, { targetVocab: 3750, targetKanji: 650, targetGrammar: 280 }],
    ['N2', 4, { targetVocab: 6000, targetKanji: 1000, targetGrammar: 420 }],
    ['N1', 5, { targetVocab: 10000, targetKanji: 2000, targetGrammar: 600 }],
  ];
  for (const [name, rank, targets] of jlptLevels) {
    const level = await prisma.examLevel.create({
      data: { examId: jlpt.id, name, rank, targets },
    });
    await prisma.examObjective.createMany({
      data: [
        { examLevelId: level.id, title: `Vocabulary for ${name}`, category: 'vocabulary', targetCount: targets.targetVocab },
        { examLevelId: level.id, title: `Kanji for ${name}`, category: 'kanji', targetCount: targets.targetKanji },
        { examLevelId: level.id, title: `Grammar points for ${name}`, category: 'grammar', targetCount: targets.targetGrammar },
        { examLevelId: level.id, title: `Reading practice for ${name}`, category: 'reading' },
        { examLevelId: level.id, title: `Listening practice for ${name}`, category: 'listening' },
      ],
    });
  }

  // BJT — graded J5 → J1+ by score.
  const bjt = await prisma.exam.create({
    data: { courseId: courses.get('japanese')!, slug: 'bjt', name: 'BJT Business Japanese Test', description: 'Business Japanese Proficiency Test, scored 0–800, grades J5–J1+.' },
  });
  const bjtLevels = ['J5', 'J4', 'J3', 'J2', 'J1', 'J1+'];
  for (let i = 0; i < bjtLevels.length; i++) {
    await prisma.examLevel.create({
      data: {
        examId: bjt.id, name: bjtLevels[i], rank: i + 1,
        targets: { targetScore: [0, 200, 320, 420, 530, 600][i] },
        description: 'Business vocabulary, keigo, documents, listening comprehension.',
      },
    });
  }

  // Kanji Kentei — level 10 (easiest) to 1.
  const kanken = await prisma.exam.create({
    data: { courseId: courses.get('japanese')!, slug: 'kanji-kentei', name: 'Kanji Kentei', description: 'Japan Kanji Aptitude Test, level 10 (easiest) to level 1 (~6,000 kanji).' },
  });
  const kankenLevels: [string, number][] = [
    ['10', 80], ['9', 240], ['8', 440], ['7', 640], ['6', 835], ['5', 1026],
    ['4', 1339], ['3', 1623], ['Pre-2', 1951], ['2', 2136], ['Pre-1', 3000], ['1', 6000],
  ];
  for (let i = 0; i < kankenLevels.length; i++) {
    await prisma.examLevel.create({
      data: { examId: kanken.id, name: kankenLevels[i][0], rank: i + 1, targets: { targetKanji: kankenLevels[i][1] } },
    });
  }

  // HSK 1–9 (HSK 3.0 word counts, placeholders).
  const hsk = await prisma.exam.create({
    data: { courseId: courses.get('chinese')!, slug: 'hsk', name: 'HSK', description: 'Hanyu Shuiping Kaoshi, levels 1–9 (HSK 3.0).' },
  });
  const hskVocab = [500, 1272, 2245, 3245, 4316, 5456, 7000, 9000, 11092];
  const hskChars = [300, 600, 900, 1200, 1500, 1800, 2200, 2600, 3000];
  for (let i = 0; i < 9; i++) {
    const level = await prisma.examLevel.create({
      data: {
        examId: hsk.id, name: `HSK ${i + 1}`, rank: i + 1,
        targets: { targetVocab: hskVocab[i], targetChars: hskChars[i] },
      },
    });
    await prisma.examObjective.createMany({
      data: [
        { examLevelId: level.id, title: `Vocabulary for HSK ${i + 1}`, category: 'vocabulary', targetCount: hskVocab[i] },
        { examLevelId: level.id, title: `Characters for HSK ${i + 1}`, category: 'characters', targetCount: hskChars[i] },
        { examLevelId: level.id, title: `Grammar for HSK ${i + 1}`, category: 'grammar' },
        { examLevelId: level.id, title: `Reading practice for HSK ${i + 1}`, category: 'reading' },
        { examLevelId: level.id, title: `Listening practice for HSK ${i + 1}`, category: 'listening' },
      ],
    });
  }
}

async function seedGoalsAndMilestones(courses: Map<string, string>) {
  const japaneseId = courses.get('japanese')!;
  const chineseId = courses.get('chinese')!;
  const mathId = courses.get('math')!;

  await prisma.courseGoal.create({
    data: {
      courseId: japaneseId, title: 'Reach 500 words', goalType: 'vocab_count',
      targetValue: 500, unit: 'words', status: 'ACTIVE',
      description: 'Build the core vocabulary base before starting the JLPT N5 path.',
    },
  });
  await prisma.courseGoal.create({
    data: {
      courseId: japaneseId, title: 'Prepare for JLPT N5', goalType: 'exam_prep', status: 'PLANNED',
      description: 'Starts once the 500-word base is reached.',
    },
  });
  // Placeholder progression milestones (editable).
  const jaMilestones = [
    ['Learn kana + core words', 'words', 100],
    ['Reach 500 words', 'words', 500],
    ['Start JLPT N5 path', 'words', 800],
    ['Reach 1,500 words', 'words', 1500],
    ['Start JLPT N4/N3 path', 'words', 3750],
    ['Reach 4,000–6,000 words', 'words', 6000],
    ['Start JLPT N2/N1 path', 'words', 10000],
    ['Add BJT track', null, null],
    ['Add Kanji Kentei track', 'kanji', 2136],
  ] as const;
  await prisma.courseMilestone.createMany({
    data: jaMilestones.map(([title, metric, targetValue], i) => ({
      courseId: japaneseId, title, metric: metric as string | null,
      targetValue: targetValue as number | null, order: i + 1,
    })),
  });

  await prisma.courseGoal.create({
    data: {
      courseId: chineseId, title: 'Reach 500 Chinese words', goalType: 'vocab_count',
      targetValue: 500, unit: 'words', status: 'ACTIVE',
      description: 'HSK 1 vocabulary base: pinyin, tones, core characters.',
    },
  });
  const zhMilestones = [
    ['Pinyin + tones solid', null, null],
    ['Reach 500 words (HSK 1)', 'words', 500],
    ['Reach 1,272 words (HSK 2)', 'words', 1272],
    ['Reach 2,245 words (HSK 3)', 'words', 2245],
    ['Reach 3,245 words (HSK 4)', 'words', 3245],
    ['Reach 5,456 words (HSK 6)', 'words', 5456],
    ['HSK 7–9 band', 'words', 11092],
  ] as const;
  await prisma.courseMilestone.createMany({
    data: zhMilestones.map(([title, metric, targetValue], i) => ({
      courseId: chineseId, title, metric: metric as string | null,
      targetValue: targetValue as number | null, order: i + 1,
    })),
  });

  await prisma.courseGoal.create({
    data: {
      courseId: mathId, title: 'Path to Iwasawa Theory', goalType: 'roadmap_target', status: 'ACTIVE',
      description: 'Work through the algebra/number-theory chain toward Iwasawa Theory.',
    },
  });
}

async function seedSchemas(courses: Map<string, string>) {
  for (const def of SEED_SCHEMAS) {
    const schema = await prisma.contentSchema.create({
      data: {
        slug: def.slug,
        name: def.name,
        itemType: def.itemType,
        category: def.category,
        description: def.description,
        courseId: def.courseSlug ? courses.get(def.courseSlug) ?? null : null,
      },
    });
    const version = await prisma.contentSchemaVersion.create({
      data: {
        schemaId: schema.id,
        version: 1,
        config: JSON.parse(JSON.stringify(def.config ?? {})),
      },
    });
    let order = 0;
    for (const f of def.fields) {
      await prisma.contentSchemaField.create({
        data: {
          versionId: version.id,
          name: f.name,
          label: f.label,
          description: f.description,
          fieldType: f.fieldType,
          required: f.required ?? false,
          order: order++,
          validationRules: JSON.parse(JSON.stringify(f.validationRules ?? {})),
          enumOptions: f.enumOptions ?? undefined,
          exampleValue: f.exampleValue === undefined ? undefined : JSON.parse(JSON.stringify(f.exampleValue)),
          defaultValue: f.defaultValue === undefined ? undefined : JSON.parse(JSON.stringify(f.defaultValue)),
          importInstructions: f.importInstructions,
          llmInstructions: f.llmInstructions,
        },
      });
    }
  }
}

async function seedMathRoadmap(courses: Map<string, string>) {
  const roadmap = await prisma.roadmap.create({
    data: {
      courseId: courses.get('math')!,
      slug: 'math-roadmap',
      name: 'Mathematics Roadmap',
      description: 'Foundations through advanced fields, with target paths to Iwasawa Theory, QFT, Physics Phenomenology, and Quantitative Finance.',
    },
  });
  const idBySlug = new Map<string, string>();
  let order = 0;
  for (const n of MATH_NODES) {
    const node = await prisma.roadmapNode.create({
      data: {
        roadmapId: roadmap.id,
        slug: n.slug,
        title: n.title,
        branch: n.branch,
        level: n.level,
        isTarget: n.isTarget ?? false,
        description: n.description,
        order: order++,
      },
    });
    idBySlug.set(n.slug, node.id);
  }
  await prisma.roadmapEdge.createMany({
    data: MATH_EDGES.map((e) => ({
      roadmapId: roadmap.id,
      fromNodeId: idBySlug.get(e.from)!,
      toNodeId: idBySlug.get(e.to)!,
      kind: e.kind ?? 'PREREQUISITE',
    })),
    skipDuplicates: true,
  });
}

async function seedSampleContent(courses: Map<string, string>) {
  // NATO alphabet: complete, small, immediately useful.
  const nato: [string, string, string][] = [
    ['A', 'Alfa', 'AL-fah'], ['B', 'Bravo', 'BRAH-voh'], ['C', 'Charlie', 'CHAR-lee'],
    ['D', 'Delta', 'DELL-tah'], ['E', 'Echo', 'ECK-oh'], ['F', 'Foxtrot', 'FOKS-trot'],
    ['G', 'Golf', 'GOLF'], ['H', 'Hotel', 'hoh-TELL'], ['I', 'India', 'IN-dee-ah'],
    ['J', 'Juliett', 'JEW-lee-ETT'], ['K', 'Kilo', 'KEY-loh'], ['L', 'Lima', 'LEE-mah'],
    ['M', 'Mike', 'MIKE'], ['N', 'November', 'no-VEM-ber'], ['O', 'Oscar', 'OSS-cah'],
    ['P', 'Papa', 'pah-PAH'], ['Q', 'Quebec', 'keh-BECK'], ['R', 'Romeo', 'ROW-me-oh'],
    ['S', 'Sierra', 'see-AIR-rah'], ['T', 'Tango', 'TANG-go'], ['U', 'Uniform', 'YOU-nee-form'],
    ['V', 'Victor', 'VIK-tah'], ['W', 'Whiskey', 'WISS-key'], ['X', 'X-ray', 'ECKS-ray'],
    ['Y', 'Yankee', 'YANG-key'], ['Z', 'Zulu', 'ZOO-loo'],
  ];
  const natoSchema = await prisma.contentSchema.findUnique({
    where: { slug: 'nato-alphabet' }, include: { versions: true },
  });
  for (const [letter, word, pronunciation] of nato) {
    await prisma.learningItem.create({
      data: {
        courseId: courses.get('nato-alphabet')!,
        schemaId: natoSchema!.id,
        schemaVersionId: natoSchema!.versions[0].id,
        itemType: 'NATOAlphabetItem',
        data: { letter, word, pronunciation },
      },
    });
  }

  // A couple of starter books demonstrating the notes system.
  const gödel = await prisma.book.create({
    data: {
      title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter', category: 'Mathematics / Philosophy',
      status: 'READING', startDate: new Date('2026-06-20'),
      relatedCourseId: courses.get('math')!,
    },
  });
  await prisma.bookNote.createMany({
    data: [
      { bookId: gödel.id, kind: 'IDEA', content: 'Strange loops: systems that reference themselves across levels of abstraction.', remember: true },
      { bookId: gödel.id, kind: 'DEFINITION', content: 'Formal system: symbols + axioms + inference rules; theorems are derivable strings.', location: 'Ch. 2', remember: true },
      { bookId: gödel.id, kind: 'REFLECTION', content: 'The MU-puzzle is a good warm-up for thinking about provability vs. truth.' },
    ],
  });
  await prisma.book.create({
    data: {
      title: 'Making Sense of Japanese', author: 'Jay Rubin', category: 'Language',
      status: 'WANT_TO_READ', relatedCourseId: courses.get('japanese')!,
    },
  });
}

async function main() {
  await reset();
  await seedUser();
  const courses = await seedCourses();
  await seedExams(courses);
  await seedGoalsAndMilestones(courses);
  await seedSchemas(courses);
  await seedMathRoadmap(courses);
  await seedSampleContent(courses);

  const counts = {
    courses: await prisma.course.count(),
    exams: await prisma.exam.count(),
    examLevels: await prisma.examLevel.count(),
    schemas: await prisma.contentSchema.count(),
    schemaFields: await prisma.contentSchemaField.count(),
    roadmapNodes: await prisma.roadmapNode.count(),
    roadmapEdges: await prisma.roadmapEdge.count(),
    learningItems: await prisma.learningItem.count(),
    books: await prisma.book.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
