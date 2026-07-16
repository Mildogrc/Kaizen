import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/ui';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ course?: string; schema?: string }> }) {
  const { course, schema } = await searchParams;
  const [courses, schemas] = await Promise.all([
    prisma.course.findMany({ orderBy: [{ tab: 'asc' }, { name: 'asc' }], select: { slug: true, name: true, color: true } }),
    prisma.contentSchema.findMany({
      include: { course: { select: { slug: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const schemaOptions = schemas.map((s) => ({
    slug: s.slug,
    name: s.name,
    itemType: s.itemType,
    courseSlug: s.course?.slug ?? null,
  }));

  const initialSchema = schema ?? '';
  const initialCourse =
    course ?? (initialSchema ? schemaOptions.find((s) => s.slug === initialSchema)?.courseSlug ?? '' : '');

  return (
    <>
      <PageHeader
        title="Import Content"
        subtitle="Pick an area, pick a content type, generate JSON with any LLM, validate, save."
      />
      <ImportForm
        courses={courses}
        schemas={schemaOptions}
        initialCourse={initialCourse}
        initialSchema={initialSchema}
      />
    </>
  );
}
