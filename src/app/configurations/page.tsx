import Link from 'next/link';
import { Card, PageHeader, Section, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { prisma } from '@/lib/db';
import { deckNames } from '@/lib/anki-connect';
import { mandarinBlueprintConfiguration, meditationConfiguration, speedReadingConfiguration } from '@/lib/app-settings';
import { configuredMathTargetSlug } from '@/lib/math-goals';
import { updateMandarinBlueprintConfiguration, updateMathGoal, updateMeditationConfiguration, updateSpeedReadingConfiguration } from './actions';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'japanese', label: 'Japanese' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'math', label: 'Math' },
  { id: 'meditation', label: 'Meditation' },
  { id: 'random-skills', label: 'Random Skills' },
] as const;

const RANDOM_SKILLS = [
  { id: 'nato', label: 'NATO', href: '/nato', detail: 'Timed adaptive code-word recall' },
  { id: 'geoguessr', label: 'GeoGuessr', href: 'https://www.geoguessr.com/analytics', detail: 'Open GeoGuessr analytics' },
  { id: 'typing', label: 'Typing', href: 'https://monkeytype.com/', detail: 'Open Monkeytype practice' },
  { id: 'reading', label: 'Reading', href: '/configurations?section=random-skills&skill=reading', detail: 'RSVP and comprehension defaults' },
  { id: 'codeforces', label: 'Codeforces', href: '/codeforces', detail: 'Profile connection and analytics' },
] as const;

export default async function ConfigurationsPage({ searchParams }: { searchParams: Promise<{ section?: string; skill?: string }> }) {
  const query = await searchParams;
  const section = SECTIONS.some((item) => item.id === query.section) ? query.section! : 'japanese';
  const [user, mathCourse, mathRoadmap] = await Promise.all([
    prisma.user.findFirst(),
    prisma.course.findUnique({ where: { slug: 'math' }, include: { goals: { where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, take: 1 } } }),
    prisma.roadmap.findUnique({ where: { slug: 'math-roadmap' }, include: { nodes: { where: { isTarget: true }, orderBy: { order: 'asc' } } } }),
  ]);
  const reading = speedReadingConfiguration(user?.settings);
  const mandarin = mandarinBlueprintConfiguration(user?.settings);
  const meditation = meditationConfiguration(user?.settings);
  const mathGoal = mathCourse?.goals[0];
  const mathTargets = mathRoadmap?.nodes ?? [];
  const currentMathTargetSlug = configuredMathTargetSlug(mathCourse?.metadata, mathTargets, mathGoal?.title);
  const ankiDeckNames = section === 'chinese' ? await deckNames().catch(() => []) : [];
  const mandarinDeckOptions = [...new Set([...ankiDeckNames, mandarin.characterDeckName, mandarin.wordDeckName])].sort((left, right) => left.localeCompare(right));

  return (
    <>
      <PageHeader title="Configurations" subtitle="Defaults and connections grouped by learning area" />
      <div className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((item) => <Link key={item.id} href={`/configurations?section=${item.id}`} className={section === item.id ? btnPrimaryCls : btnCls}>{item.label}</Link>)}
      </div>

      <Section title="Shared tools">
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/review"><Card className="h-full hover:border-accent/50"><div className="font-medium">In-app review</div><p className="mt-1 text-[12px] text-muted">Review flashcards and scheduled Japanese grammar.</p></Card></Link>
          <Link href="/schemas"><Card className="h-full hover:border-accent/50"><div className="font-medium">Schema Designer</div><p className="mt-1 text-[12px] text-muted">Manage reusable content structures and prompts.</p></Card></Link>
        </div>
      </Section>

      {section === 'japanese' && <Section title="Japanese">
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/anki"><Card className="h-full hover:border-accent/50"><div className="font-medium">Anki mapping</div><p className="mt-1 text-[12px] text-muted">Deck sync, known-word counting, and review data.</p></Card></Link>
          <Link href="/japanese/grammar"><Card className="h-full hover:border-accent/50"><div className="font-medium">Grammar coach</div><p className="mt-1 text-[12px] text-muted">Five new points per week plus scheduled review.</p></Card></Link>
          <Link href="/words?lang=ja"><Card className="h-full hover:border-accent/50"><div className="font-medium">Known words</div><p className="mt-1 text-[12px] text-muted">Migaku, Anki, and manual word sources.</p></Card></Link>
        </div>
      </Section>}

      {section === 'chinese' && <Section title="Chinese">
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/chinese/mandarin-blueprint"><Card className="h-full hover:border-accent/50"><div className="font-medium">Mandarin Blueprint</div><p className="mt-1 text-[12px] text-muted">Complete levels and push their characters and words to Anki.</p></Card></Link>
          <Link href="/anki"><Card className="h-full hover:border-accent/50"><div className="font-medium">Anki mapping</div><p className="mt-1 text-[12px] text-muted">Deck sync and review data.</p></Card></Link>
          <Link href="/words?lang=zh"><Card className="h-full hover:border-accent/50"><div className="font-medium">Known words</div><p className="mt-1 text-[12px] text-muted">Chinese vocabulary sources and counts.</p></Card></Link>
        </div>
        <Card className="mt-3">
          <form action={updateMandarinBlueprintConfiguration} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-[11px] text-muted">Character deck<select name="characterDeckName" defaultValue={mandarin.characterDeckName} className={`${inputCls} mt-1`}>{mandarinDeckOptions.map((deckName) => <option key={deckName} value={deckName}>{deckName}</option>)}</select></label>
            <label className="text-[11px] text-muted">Word deck<select name="wordDeckName" defaultValue={mandarin.wordDeckName} className={`${inputCls} mt-1`}>{mandarinDeckOptions.map((deckName) => <option key={deckName} value={deckName}>{deckName}</option>)}</select></label>
            <button className={btnPrimaryCls}>Save deck names</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">Character cards use English definition → character recall. Word cards show the Mandarin word first, then pinyin, audio, and definitions.</p>
        </Card>
      </Section>}

      {section === 'math' && <Section title="Math goal">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <div className="text-[13px] font-medium">Long-term goals</div>
            <div className="mt-3 flex flex-wrap gap-2">{mathTargets.map((target) => <span key={target.id} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">{target.title}</span>)}</div>
          </Card>
          <Card>
            <form action={updateMathGoal} className="grid gap-3">
              <label className="text-[11px] text-muted">Current goal<select name="targetSlug" required defaultValue={currentMathTargetSlug ?? ''} className={`${inputCls} mt-1`}>{mathTargets.map((target) => <option key={target.id} value={target.slug}>{target.title}</option>)}</select></label>
              <div><button type="submit" className={btnPrimaryCls}>Save current goal</button></div>
            </form>
          </Card>
        </div>
      </Section>}

      {section === 'meditation' && <Section title="Meditation defaults">
        <Card>
          <form action={updateMeditationConfiguration} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-[11px] text-muted">Minutes per session<input name="sessionMinutes" type="number" min="1" max="180" defaultValue={meditation.sessionMinutes} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Target days per week<input name="targetDaysPerWeek" type="number" min="1" max="7" defaultValue={meditation.targetDaysPerWeek} className={`${inputCls} mt-1`} /></label>
            <button type="submit" className={btnPrimaryCls}>Save meditation defaults</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">Checking meditation on Daily logs one session using this duration.</p>
          <Link href="/analytics?area=meditation" className="mt-3 inline-block text-[12px] text-accent hover:underline">Open meditation analytics →</Link>
        </Card>
      </Section>}

      {section === 'random-skills' && <>
        <Section title="Random skills">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {RANDOM_SKILLS.map((skill) => {
              const external = skill.href.startsWith('https://');
              return <Link key={skill.id} href={skill.href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}><Card className={`h-full hover:border-accent/50 ${query.skill === skill.id ? 'border-accent/60' : ''}`}><div className="font-medium">{skill.label}</div><p className="mt-1 text-[11px] text-muted">{skill.detail}</p></Card></Link>;
            })}
          </div>
        </Section>
        {query.skill === 'reading' && <Section title="Reading defaults">
          <Card>
            <form action={updateSpeedReadingConfiguration} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-[11px] text-muted">Mode<select name="mode" defaultValue={reading.mode} className={`${inputCls} mt-1`}><option value="RSVP">RSVP</option><option value="PACED">Paced</option><option value="CHUNKING">Chunking</option><option value="BENCHMARK">Benchmark</option></select></label>
              <label className="text-[11px] text-muted">Starting WPM<input name="wpm" type="number" min="50" max="2000" step="10" defaultValue={reading.wpm} className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Words at once<input name="chunkSize" type="number" min="1" max="5" defaultValue={reading.chunkSize} className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Font size<input name="fontSize" type="number" min="16" max="96" step="2" defaultValue={reading.fontSize} className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Session minutes<input name="sessionMinutes" type="number" min="1" max="30" defaultValue={reading.sessionMinutes} className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Comprehension threshold<input name="comprehensionThreshold" type="number" min="50" max="100" defaultValue={reading.comprehensionThreshold} className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Topic category<input name="category" defaultValue={reading.category} placeholder="all" className={`${inputCls} mt-1`} /></label>
              <label className="text-[11px] text-muted">Difficulty<input name="difficulty" defaultValue={reading.difficulty} placeholder="all" className={`${inputCls} mt-1`} /></label>
              <label className="flex items-center gap-2 text-[12px]"><input name="punctuationPause" type="checkbox" defaultChecked={reading.punctuationPause} />Pause at punctuation</label>
              <div className="md:col-span-2 xl:col-span-3" />
              <button type="submit" className={btnPrimaryCls}>Save reading defaults</button>
            </form>
          </Card>
        </Section>}
      </>}
    </>
  );
}
