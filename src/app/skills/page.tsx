import Link from 'next/link';
import { Badge, Card, PageHeader, StatCard } from '@/components/ui';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SkillsPage() {
  const [courses, codeforcesProfiles, readingSessions, natoSessions] = await Promise.all([
    prisma.course.findMany({
      where: { tab: 'SKILLS' },
      include: { _count: { select: { learningItems: true } } },
    }),
    prisma.codeforcesProfile.count(),
    prisma.speedReadingSession.count(),
    prisma.studySession.count({ where: { mode: 'nato' } }),
  ]);
  const courseBySlug = new Map(courses.map((course) => [course.slug, course]));
  const courseCard = (slug: string, label: string, href: string, detail: string) => {
    const course = courseBySlug.get(slug);
    return { label, href, detail, count: course?._count.learningItems ?? 0, unit: 'items' };
  };
  const skills = [
    { label: 'NATO', href: '/nato', detail: 'Timed code-word recall weighted toward slow letters', count: natoSessions, unit: 'sessions' },
    courseCard('geoguessr', 'GeoGuessr', 'https://www.geoguessr.com/analytics', 'Open your GeoGuessr analytics and weekly practice'),
    courseCard('typing', 'Typing', 'https://monkeytype.com/', 'Open Monkeytype for typing practice'),
    { label: 'Reading', href: '/speed-reading', detail: 'RSVP, paced, chunking, benchmark, and retention', count: readingSessions, unit: 'sessions' },
    { label: 'Codeforces', href: '/codeforces', detail: 'Problem ratings, contests, and activity heatmaps', count: codeforcesProfiles, unit: 'profiles' },
  ];

  return <>
    <PageHeader title="Random Skills" subtitle="Choose a focused skill to practice or analyze" />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
      <StatCard label="Skills" value={skills.length} />
      <StatCard label="Learning items" value={courses.reduce((sum, course) => sum + course._count.learningItems, 0)} />
      <StatCard label="Reading sessions" value={readingSessions} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {skills.map((skill) => {
        const external = skill.href.startsWith('https://');
        return <Link key={skill.label} href={skill.href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}><Card className="flex h-full min-h-36 flex-col hover:border-accent/50"><div className="flex items-center justify-between gap-2"><span className="text-[15px] font-semibold">{skill.label}</span><Badge>{skill.count} {skill.unit}</Badge></div><p className="mt-2 text-[12px] text-muted">{skill.detail}</p><span className="mt-auto pt-4 text-[12px] text-accent">Open →</span></Card></Link>;
      })}
    </div>
    <div className="mt-5 text-[11px] text-muted">Defaults for these modules live under <Link className="text-accent hover:underline" href="/configurations?section=random-skills">Configurations → Random Skills</Link>.</div>
  </>;
}
