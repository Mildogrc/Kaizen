import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/ui';
import { NewSchemaWizard } from './wizard';

export const dynamic = 'force-dynamic';

export default async function NewSchemaPage() {
  const courses = await prisma.course.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } });
  return (
    <>
      <PageHeader
        title="New Course / Schema"
        subtitle="Define what content for this course looks like. Import and flashcard generation follow from the schema."
      />
      <NewSchemaWizard courses={courses} />
    </>
  );
}
