// Imports an extracted Anki .apkg (new format: collection.anki21b + protobuf
// media manifest) into the app: LearningItems + Flashcards + ReviewRecords in
// the Chinese course, preserving Anki scheduling state (due, interval, ease,
// reps, lapses). Media files are copied to public/anki-media/.
//
// Usage: npx tsx scripts/import-anki.ts <extracted-dir> [--force]
//   <extracted-dir> must contain collection.sqlite (zstd-decompressed
//   collection.anki21b), media.bin (zstd-decompressed media manifest), and
//   the numbered media files.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SOURCE_NAME = 'mandarin1k.apkg';
const MEDIA_DIR = join(process.cwd(), 'public', 'anki-media');

const extractedDir = process.argv[2];
const force = process.argv.includes('--force');
if (!extractedDir) {
  console.error('Usage: npx tsx scripts/import-anki.ts <extracted-dir> [--force]');
  process.exit(1);
}

function sql<T>(query: string): T[] {
  const out = execFileSync('sqlite3', ['-json', join(extractedDir, 'collection.sqlite'), query], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.trim() ? (JSON.parse(out) as T[]) : [];
}

// --- Minimal protobuf parse of the media manifest -------------------------
// MediaEntries { repeated MediaEntry entries = 1 }
// MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; }
// The archive file named "<i>" corresponds to entries[i].name.
function parseMediaManifest(buf: Buffer): string[] {
  const names: string[] = [];
  let pos = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = buf[pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
  };
  while (pos < buf.length) {
    const tag = readVarint();
    if (tag >> 3 !== 1 || (tag & 7) !== 2) break; // expect entries, length-delimited
    const entryLen = readVarint();
    const entryEnd = pos + entryLen;
    let name = '';
    while (pos < entryEnd) {
      const fieldTag = readVarint();
      const fieldNo = fieldTag >> 3;
      const wire = fieldTag & 7;
      if (wire === 2) {
        const len = readVarint();
        if (fieldNo === 1) name = buf.subarray(pos, pos + len).toString('utf8');
        pos += len;
      } else if (wire === 0) {
        readVarint();
      } else {
        throw new Error(`Unexpected wire type ${wire}`);
      }
    }
    names.push(name);
  }
  return names;
}

interface NoteRow { id: number; flds: string }
interface CardRow {
  id: number; nid: number; queue: number; type: number;
  due: number; ivl: number; factor: number; reps: number; lapses: number;
}

// Field order for the "Refold Mandarin 1k+" note type.
const FIELDS = [
  'key', 'simplified', 'traditional', 'pinyin', 'meaning', 'partOfSpeech',
  'audio', 'sentenceSimplified', 'sentenceTraditional', 'sentencePinyin',
  'sentenceMeaning', 'sentenceAudio', 'sentenceImage', 'twPronunciation',
  'note', 'frontAudio',
] as const;

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
const soundFile = (s: string) => /\[sound:([^\]]+)\]/.exec(s)?.[1] ?? null;
const imgFile = (s: string) => /<img[^>]+src="([^"]+)"/.exec(s)?.[1] ?? null;
const mediaUrl = (f: string | null) => (f ? `/anki-media/${f}` : null);

const POS_MAP: Record<string, string> = {
  noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb',
  'measure word': 'measure word', conjunction: 'conjunction', particle: 'particle',
  auxiliary: 'particle', expression: 'expression',
};

async function main() {
  const existing = await prisma.importBatch.findFirst({ where: { sourceName: SOURCE_NAME } });
  if (existing && !force) {
    console.error(`${SOURCE_NAME} was already imported (batch ${existing.id}). Re-run with --force to replace.`);
    process.exit(1);
  }
  if (existing && force) {
    // LearningItem cascade deletes flashcards → review records.
    await prisma.learningItem.deleteMany({ where: { importBatchId: existing.id } });
    await prisma.importBatch.delete({ where: { id: existing.id } });
    console.log('Removed previous import.');
  }

  const course = await prisma.course.findUniqueOrThrow({ where: { slug: 'chinese' } });
  const schema = await prisma.contentSchema.findUniqueOrThrow({
    where: { slug: 'chinese-vocabulary' },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  // 1. Media.
  const manifest = parseMediaManifest(readFileSync(join(extractedDir, 'media.bin')));
  mkdirSync(MEDIA_DIR, { recursive: true });
  let copied = 0;
  manifest.forEach((name, i) => {
    const src = join(extractedDir, String(i));
    const dest = join(MEDIA_DIR, name);
    if (existsSync(src) && !existsSync(dest)) {
      copyFileSync(src, dest);
      copied++;
    }
  });
  console.log(`Media: ${manifest.length} files in manifest, ${copied} copied to public/anki-media.`);

  // 2. Rows.
  const crt = sql<{ crt: number }>('select crt from col')[0].crt;
  // sqlite3's -json mode mangles the 0x1f field separator (drops the escape
  // backslash), so replace it with a printable token inside SQL.
  const notes = sql<NoteRow>("select id, replace(flds, char(31), '<<FS>>') as flds from notes");
  const cards = sql<CardRow>('select id, nid, queue, type, due, ivl, factor, reps, lapses from cards');
  const cardByNote = new Map(cards.map((c) => [c.nid, c]));
  console.log(`Parsed ${notes.length} notes, ${cards.length} cards (crt day 0 = ${new Date(crt * 1000).toISOString().slice(0, 10)}).`);

  const batch = await prisma.importBatch.create({
    data: {
      courseId: course.id,
      schemaVersionId: schema.versions[0].id,
      sourceName: SOURCE_NAME,
      format: 'apkg',
      status: 'COMPLETED',
      totalCount: notes.length,
    },
  });

  const now = new Date();
  let created = 0;
  const counts = { new: 0, learning: 0, review: 0, suspended: 0 };

  for (const note of notes) {
    const f = note.flds.split('<<FS>>');
    const get = (name: (typeof FIELDS)[number]) => f[FIELDS.indexOf(name)] ?? '';

    const simplified = stripHtml(get('simplified'));
    const pinyin = stripHtml(get('pinyin'));
    const meaning = stripHtml(get('meaning'));
    if (!simplified || !meaning) continue;

    const audio = mediaUrl(soundFile(get('audio')));
    const data: Record<string, unknown> = {
      simplified,
      pinyin,
      meaning,
      exampleSentence: stripHtml(get('sentenceSimplified')) || undefined,
      exampleTranslation: stripHtml(get('sentenceMeaning')) || undefined,
      audio: audio ?? undefined,
      notes: stripHtml(get('note')) || undefined,
      frequencyRank: Number(stripHtml(get('key'))) || undefined,
    };
    const traditional = stripHtml(get('traditional'));
    if (traditional && traditional !== simplified) data.traditional = traditional;
    const pos = POS_MAP[stripHtml(get('partOfSpeech')).toLowerCase()];
    if (pos) data.partOfSpeech = pos;

    const item = await prisma.learningItem.create({
      data: {
        courseId: course.id,
        schemaId: schema.id,
        schemaVersionId: schema.versions[0].id,
        itemType: schema.itemType,
        data: JSON.parse(JSON.stringify(data)),
        importBatchId: batch.id,
      },
    });

    const flashcard = await prisma.flashcard.create({
      data: {
        courseId: course.id,
        learningItemId: item.id,
        front: simplified,
        back: `${pinyin} — ${meaning}`,
        metadata: JSON.parse(JSON.stringify({
          source: 'anki',
          anki: { noteId: note.id, deck: 'Refold Mandarin 1k+' },
          traditional: traditional || undefined,
          partOfSpeech: stripHtml(get('partOfSpeech')) || undefined,
          audio,
          frontAudio: mediaUrl(soundFile(get('frontAudio'))),
          sentence: {
            simplified: stripHtml(get('sentenceSimplified')) || undefined,
            traditional: stripHtml(get('sentenceTraditional')) || undefined,
            pinyin: stripHtml(get('sentencePinyin')) || undefined,
            meaning: stripHtml(get('sentenceMeaning')) || undefined,
            audio: mediaUrl(soundFile(get('sentenceAudio'))),
            image: mediaUrl(imgFile(get('sentenceImage'))),
          },
          twPronunciation: stripHtml(get('twPronunciation')) || undefined,
          note: stripHtml(get('note')) || undefined,
        })),
      },
    });

    // 3. Scheduling state.
    const card = cardByNote.get(note.id);
    let review: {
      ease: number; intervalDays: number; dueAt: Date; repetitions: number;
      lapseCount: number; maturity: 'NEW' | 'LEARNING' | 'YOUNG' | 'MATURE'; isSuspended: boolean;
    } = { ease: 2.5, intervalDays: 0, dueAt: now, repetitions: 0, lapseCount: 0, maturity: 'NEW', isSuspended: false };

    if (card) {
      const ease = card.factor > 0 ? card.factor / 1000 : 2.5;
      const suspended = card.queue === -1;
      const effQueue = suspended ? cardTypeToQueue(card.type) : card.queue;
      if (effQueue === 2) {
        // due = days since collection creation day
        review = {
          ease, intervalDays: card.ivl,
          dueAt: new Date((crt + card.due * 86_400) * 1000),
          repetitions: card.reps, lapseCount: card.lapses,
          maturity: card.ivl >= 21 ? 'MATURE' : 'YOUNG', isSuspended: suspended,
        };
        counts.review++;
      } else if (effQueue === 1 || effQueue === 3) {
        // (re)learning: due is epoch seconds for intraday, day number otherwise
        const dueAt = card.due > 1_000_000_000 ? new Date(card.due * 1000) : new Date((crt + card.due * 86_400) * 1000);
        review = {
          ease, intervalDays: 0, dueAt,
          repetitions: card.reps, lapseCount: card.lapses,
          maturity: 'LEARNING', isSuspended: suspended,
        };
        counts.learning++;
      } else {
        counts.new++;
      }
      if (suspended) counts.suspended++;
    }

    await prisma.reviewRecord.create({
      data: {
        flashcardId: flashcard.id,
        ease: review.ease,
        intervalDays: review.intervalDays,
        dueAt: review.dueAt,
        repetitions: review.repetitions,
        lapseCount: review.lapseCount,
        maturity: review.maturity,
        isSuspended: review.isSuspended,
        isLeech: review.lapseCount >= 8,
      },
    });
    created++;
  }

  await prisma.importBatch.update({ where: { id: batch.id }, data: { validCount: created } });

  const dueNow = await prisma.reviewRecord.count({ where: { dueAt: { lte: now }, isSuspended: false } });
  console.log(`Imported ${created} items+cards. States: ${counts.new} new, ${counts.learning} learning, ${counts.review} review, ${counts.suspended} suspended.`);
  console.log(`Cards due right now (all courses): ${dueNow}`);
}

function cardTypeToQueue(type: number) {
  return type === 2 ? 2 : type === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
