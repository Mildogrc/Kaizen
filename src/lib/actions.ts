'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from './db';
import { rate, type Rating } from './srs';
import { validateItems } from './schema-zod';
import { fieldRowToDef } from './schema-serialize';
import type { FieldDef } from './schema-types';

// ----------------------------------------------------------------- Books

export async function createBook(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;
  await prisma.book.create({
    data: {
      title,
      author: String(formData.get('author') ?? '').trim() || null,
      category: String(formData.get('category') ?? '').trim() || null,
      sourceLanguage: String(formData.get('sourceLanguage') ?? '').trim() || null,
      pageCount: formData.get('pageCount') ? Number(formData.get('pageCount')) || null : null,
      status: (String(formData.get('status')) || 'WANT_TO_READ') as never,
    },
  });
  revalidatePath('/books');
}

export async function updateBook(bookId: string, formData: FormData) {
  const status = String(formData.get('status') ?? '') as never;
  const rating = formData.get('rating') ? Number(formData.get('rating')) : null;
  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (rating) data.rating = rating;
  if (formData.has('pageCount')) {
    data.pageCount = formData.get('pageCount') ? Number(formData.get('pageCount')) || null : null;
  }
  if (status === 'READING') data.startDate = new Date();
  if (status === 'FINISHED') data.finishDate = new Date();
  await prisma.book.update({ where: { id: bookId }, data });
  revalidatePath('/books');
  revalidatePath(`/books/${bookId}`);
}

export async function deleteBook(bookId: string) {
  await prisma.book.delete({ where: { id: bookId } });
  revalidatePath('/books');
  redirect('/books');
}

export async function addBookNote(bookId: string, formData: FormData) {
  const content = String(formData.get('content') ?? '').trim();
  if (!content) return;
  await prisma.bookNote.create({
    data: {
      bookId,
      kind: (String(formData.get('kind')) || 'NOTE') as never,
      content,
      location: String(formData.get('location') ?? '').trim() || null,
      remember: formData.get('remember') === 'on',
    },
  });
  revalidatePath(`/books/${bookId}`);
}

export async function toggleNoteRemember(noteId: string) {
  const note = await prisma.bookNote.findUniqueOrThrow({ where: { id: noteId } });
  await prisma.bookNote.update({ where: { id: noteId }, data: { remember: !note.remember } });
  revalidatePath(`/books/${note.bookId}`);
}

export async function deleteBookNote(noteId: string) {
  const note = await prisma.bookNote.delete({ where: { id: noteId } });
  revalidatePath(`/books/${note.bookId}`);
}

// ---------------------------------------------------------------- Roadmap

const NODE_STATUS_CYCLE = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;

export async function cycleNodeStatus(nodeId: string) {
  const node = await prisma.roadmapNode.findUniqueOrThrow({ where: { id: nodeId } });
  const next =
    NODE_STATUS_CYCLE[(NODE_STATUS_CYCLE.indexOf(node.status as never) + 1) % NODE_STATUS_CYCLE.length];
  await prisma.roadmapNode.update({ where: { id: nodeId }, data: { status: next } });
  revalidatePath('/math');
}

// ------------------------------------------------------------------ Goals

export async function addGoal(courseId: string, formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;
  const targetValue = formData.get('targetValue') ? Number(formData.get('targetValue')) : null;
  await prisma.courseGoal.create({
    data: {
      courseId,
      title,
      goalType: String(formData.get('goalType') ?? 'custom'),
      targetValue,
      unit: String(formData.get('unit') ?? '').trim() || null,
      status: 'ACTIVE',
    },
  });
  revalidatePath('/', 'layout');
}

export async function completeGoal(goalId: string) {
  await prisma.courseGoal.update({ where: { id: goalId }, data: { status: 'COMPLETED' } });
  revalidatePath('/', 'layout');
}

// --------------------------------------------------------- Schema designer

export interface NewSchemaPayload {
  name: string;
  itemType: string;
  category: string;
  courseSlug?: string;
  newCourseName?: string;
  description?: string;
  target?: string;
  examName?: string;
  targetDate?: string;
  fields: FieldDef[];
  flashcardRules?: { name: string; front: string; back: string }[];
  practiceModes?: string[];
  srsEnabled?: boolean;
  completionCriteria?: string;
  llmPrompt?: string;
}

function slugify(input: string) {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function createSchemaWithCourse(payload: NewSchemaPayload) {
  let courseId: string | null = null;
  if (payload.courseSlug) {
    const course = await prisma.course.findUnique({ where: { slug: payload.courseSlug } });
    courseId = course?.id ?? null;
  } else if (payload.newCourseName) {
    const slug = slugify(payload.newCourseName);
    const existing = await prisma.course.findUnique({ where: { slug } });
    const course =
      existing ??
      (await prisma.course.create({
        data: {
          slug,
          name: payload.newCourseName,
          category: (payload.category || 'CUSTOM') as never,
          tab: 'CUSTOM',
          description: payload.target ? `Target: ${payload.target}` : null,
          metadata: {
            exam: payload.examName || null,
            targetDate: payload.targetDate || null,
          },
        },
      }));
    courseId = course.id;
    if (payload.target) {
      await prisma.courseGoal.create({
        data: {
          courseId: course.id,
          title: payload.target,
          goalType: payload.examName ? 'exam_prep' : 'custom',
          targetDate: payload.targetDate ? new Date(payload.targetDate) : null,
        },
      });
    }
  }

  const baseSlug = slugify(payload.itemType || payload.name);
  let slug = baseSlug;
  for (let i = 2; await prisma.contentSchema.findUnique({ where: { slug } }); i++) {
    slug = `${baseSlug}-${i}`;
  }

  const schema = await prisma.contentSchema.create({
    data: {
      slug,
      name: payload.name,
      itemType: payload.itemType,
      category: (payload.category || 'CUSTOM') as never,
      description: payload.description || null,
      courseId,
    },
  });
  const version = await prisma.contentSchemaVersion.create({
    data: {
      schemaId: schema.id,
      version: 1,
      config: JSON.parse(
        JSON.stringify({
          flashcardRules: payload.flashcardRules ?? [],
          practiceModes: payload.practiceModes ?? [],
          srsRules: payload.srsEnabled ? { algorithm: 'sm2', newPerDay: 20 } : undefined,
          completionCriteria: payload.completionCriteria,
          llmPrompt: payload.llmPrompt,
        }),
      ),
    },
  });
  for (let i = 0; i < payload.fields.length; i++) {
    const f = payload.fields[i];
    await prisma.contentSchemaField.create({
      data: {
        versionId: version.id,
        name: f.name,
        label: f.label || f.name,
        description: f.description || null,
        fieldType: f.fieldType,
        required: f.required ?? false,
        order: i,
        validationRules: JSON.parse(JSON.stringify(f.validationRules ?? {})),
        enumOptions: f.enumOptions ?? undefined,
        exampleValue: f.exampleValue === undefined ? undefined : JSON.parse(JSON.stringify(f.exampleValue)),
        defaultValue: f.defaultValue === undefined ? undefined : JSON.parse(JSON.stringify(f.defaultValue)),
        importInstructions: f.importInstructions || null,
        llmInstructions: f.llmInstructions || null,
      },
    });
  }
  revalidatePath('/schemas');
  return { slug };
}

// ----------------------------------------------------------------- Review

export async function rateFlashcard(recordId: string, rating: Rating) {
  const record = await prisma.reviewRecord.findUniqueOrThrow({ where: { id: recordId } });
  const result = rate(
    {
      ease: record.ease,
      intervalDays: record.intervalDays,
      repetitions: record.repetitions,
      lapseCount: record.lapseCount,
      isLeech: record.isLeech,
    },
    rating,
  );
  await prisma.reviewRecord.update({
    where: { id: recordId },
    data: {
      ease: result.ease,
      intervalDays: result.intervalDays,
      dueAt: result.dueAt,
      repetitions: result.repetitions,
      lapseCount: result.lapseCount,
      isLeech: result.isLeech,
      maturity: result.maturity,
      lastRating: rating,
      lastReviewedAt: new Date(),
    },
  });
  if (record.flashcardId) {
    await prisma.attempt.create({
      data: { flashcardId: record.flashcardId, rating, correct: rating !== 'AGAIN' },
    });
  }
  return { dueAt: result.dueAt.toISOString(), intervalDays: result.intervalDays };
}

// ----------------------------------------------------------------- Import

export interface ImportPreview {
  ok: boolean;
  message?: string;
  total: number;
  validCount: number;
  errorCount: number;
  validSample: { index: number; data: Record<string, unknown> }[];
  errors: { index: number; errors: string[] }[];
  batchId?: string;
  savedCount?: number;
}

export async function runImport(input: {
  schemaSlug: string;
  jsonText: string;
  commit: boolean;
}): Promise<ImportPreview> {
  const schema = await prisma.contentSchema.findUnique({
    where: { slug: input.schemaSlug },
    include: { versions: { where: { isActive: true }, orderBy: { version: 'desc' }, take: 1, include: { fields: { orderBy: { order: 'asc' } } } } },
  });
  if (!schema || schema.versions.length === 0) {
    return { ok: false, message: 'Schema not found.', total: 0, validCount: 0, errorCount: 0, validSample: [], errors: [] };
  }
  const version = schema.versions[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.jsonText);
  } catch (e) {
    return { ok: false, message: `Invalid JSON: ${(e as Error).message}`, total: 0, validCount: 0, errorCount: 0, validSample: [], errors: [] };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const fieldDefs = version.fields.map(fieldRowToDef);
  const result = validateItems(fieldDefs, items);

  const preview: ImportPreview = {
    ok: true,
    total: items.length,
    validCount: result.valid.length,
    errorCount: result.invalid.length,
    validSample: result.valid.slice(0, 10),
    errors: result.invalid.slice(0, 20),
  };

  if (input.commit && result.valid.length > 0) {
    const courseId = schema.courseId;
    if (!courseId) {
      return { ...preview, ok: false, message: 'Schema is not attached to a course; cannot import.' };
    }
    const batch = await prisma.importBatch.create({
      data: {
        courseId,
        schemaVersionId: version.id,
        sourceName: 'pasted JSON',
        format: 'json',
        status: result.invalid.length > 0 ? 'PARTIAL' : 'COMPLETED',
        totalCount: items.length,
        validCount: result.valid.length,
        errorCount: result.invalid.length,
        errors: JSON.parse(JSON.stringify(result.invalid)),
      },
    });
    await prisma.learningItem.createMany({
      data: result.valid.map((v) => ({
        courseId,
        schemaId: schema.id,
        schemaVersionId: version.id,
        itemType: schema.itemType,
        data: JSON.parse(JSON.stringify(v.data)),
        importBatchId: batch.id,
      })),
    });
    preview.batchId = batch.id;
    preview.savedCount = result.valid.length;
    revalidatePath('/', 'layout');
  }

  return preview;
}
