import Link from 'next/link';
import { Card, PageHeader, Section, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { prisma } from '@/lib/db';
import { deckNames } from '@/lib/anki-connect';
import { japaneseAdaptiveAnkiConfiguration, japaneseGrammarConfiguration, japaneseKanjiRepairConfiguration, mandarinBlueprintConfiguration, meditationConfiguration, speedReadingConfiguration } from '@/lib/app-settings';
import { configuredMathLongTermTargetSlugs, configuredMathTargetSlug } from '@/lib/math-goals';
import {
  updateMandarinBlueprintConfiguration,
  resetJapaneseAdaptiveAnki,
  updateJapaneseAdaptiveAnkiConfiguration,
  updateJapaneseGrammarConfiguration,
  updateJapaneseKanjiRepairConfiguration,
  updateMathGoal,
  updateMathLongTermGoal,
  updateMeditationConfiguration,
  updateSpeedReadingConfiguration,
} from './actions';

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
  { id: 'youtube', label: 'YouTube', href: '/youtube', detail: 'Lecture playlists and saved playback' },
] as const;

export default async function ConfigurationsPage({ searchParams }: { searchParams: Promise<{ section?: string; skill?: string }> }) {
  const query = await searchParams;
  const section = SECTIONS.some((item) => item.id === query.section) ? query.section! : 'japanese';
  const [user, mathCourse, mathRoadmap, japaneseAnkiMappings] = await Promise.all([
    prisma.user.findFirst(),
    prisma.course.findUnique({ where: { slug: 'math' }, include: { goals: { where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, take: 1 } } }),
    prisma.roadmap.findUnique({ where: { slug: 'math-roadmap' }, include: { nodes: { orderBy: { order: 'asc' } } } }),
    prisma.ankiDeckMapping.findMany({
      where: { course: { slug: 'japanese' } },
      select: { id: true, deckName: true, adaptiveNewCards: true },
      orderBy: { deckName: 'asc' },
    }),
  ]);
  const reading = speedReadingConfiguration(user?.settings);
  const japaneseGrammar = japaneseGrammarConfiguration(user?.settings);
  const japaneseKanjiRepair = japaneseKanjiRepairConfiguration(user?.settings);
  const japaneseAdaptiveAnki = japaneseAdaptiveAnkiConfiguration(user?.settings);
  const adaptiveAnkiState = user
    ? await prisma.ankiAdaptiveBudgetState.findUnique({ where: { userId: user.id } })
    : null;
  const hasAdaptiveMapping = japaneseAnkiMappings.some((mapping) => mapping.adaptiveNewCards);
  const recommendedAdaptiveMappingId = !hasAdaptiveMapping
    ? japaneseAnkiMappings.find((mapping) => !/(?:rtk|kanji)/i.test(mapping.deckName))?.id
    : undefined;
  const mandarin = mandarinBlueprintConfiguration(user?.settings);
  const meditation = meditationConfiguration(user?.settings);
  const mathGoal = mathCourse?.goals[0];
  const mathNodes = mathRoadmap?.nodes ?? [];
  const longTermMathTargetSlugs = configuredMathLongTermTargetSlugs(mathCourse?.metadata, mathNodes);
  const mathTargets = mathNodes.filter((node) => longTermMathTargetSlugs.includes(node.slug));
  const availableMathTargets = mathNodes.filter((node) => !longTermMathTargetSlugs.includes(node.slug));
  const currentMathTargetSlug = configuredMathTargetSlug(mathCourse?.metadata, mathTargets, mathGoal?.title);
  const ankiDeckNames = section === 'chinese' ? await deckNames().catch(() => []) : [];
  const mandarinDeckOptions = [...new Set([
    ...ankiDeckNames,
    mandarin.characterDeckName,
    mandarin.reversedCharacterDeckName,
    mandarin.wordDeckName,
  ])].sort((left, right) => left.localeCompare(right));

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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Link href="/anki"><Card className="h-full hover:border-accent/50"><div className="font-medium">Anki mapping</div><p className="mt-1 text-[12px] text-muted">Deck sync, known-word counting, and review data.</p></Card></Link>
          <Link href="/configurations?section=japanese#adaptive-budgeting"><Card className="h-full border-violet-900/60 hover:border-violet-500/70"><div className="font-medium">Adaptive budgeting</div><p className="mt-1 text-[12px] text-muted">{japaneseAdaptiveAnki.enabled ? `${adaptiveAnkiState?.currentBudget ?? japaneseAdaptiveAnki.startingBudget} new vocabulary cards today` : 'Configure automatic Japanese vocabulary limits'}</p></Card></Link>
          <Link href="/japanese/grammar"><Card className="h-full hover:border-accent/50"><div className="font-medium">Grammar coach</div><p className="mt-1 text-[12px] text-muted">{japaneseGrammar.newPointsPerBatch} new points every {japaneseGrammar.newBatchIntervalDays} {japaneseGrammar.newBatchIntervalDays === 1 ? 'day' : 'days'}, plus scheduled review.</p></Card></Link>
          <Link href="/japanese/kanji-repair"><Card className="h-full hover:border-accent/50"><div className="font-medium">Kanji Repair</div><p className="mt-1 text-[12px] text-muted">Focused daily repair ranked from Anki review history.</p></Card></Link>
          <Link href="/words?lang=ja"><Card className="h-full hover:border-accent/50"><div className="font-medium">Known words</div><p className="mt-1 text-[12px] text-muted">Migaku, Anki, and manual word sources.</p></Card></Link>
        </div>
        <Card className="mt-3">
          <form action={updateJapaneseGrammarConfiguration} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-[11px] text-muted">New grammar points per batch<input name="newPointsPerBatch" type="number" min="1" max="50" defaultValue={japaneseGrammar.newPointsPerBatch} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Days between new batches<input name="newBatchIntervalDays" type="number" min="1" max="90" defaultValue={japaneseGrammar.newBatchIntervalDays} className={`${inputCls} mt-1`} /></label>
            <button type="submit" className={btnPrimaryCls}>Save grammar schedule</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">This controls only when unseen grammar is introduced. SRS reviews still appear whenever they are due.</p>
        </Card>
        <div id="adaptive-budgeting" className="scroll-mt-6">
        <Card className="mt-3 border-violet-900/60">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
            <div>
              <div className="font-medium">Adaptive Anki budgeting</div>
              <p className="mt-1 text-[11px] text-muted">Automatically adjusts only the selected Japanese vocabulary deck&apos;s new-card limit.</p>
            </div>
            <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${japaneseAdaptiveAnki.enabled ? 'border-green-800 bg-green-950/40 text-green-300' : 'border-line bg-surface-2 text-muted'}`}>{japaneseAdaptiveAnki.enabled ? 'Enabled' : 'Off'}</span>
          </div>
          <form action={updateJapaneseAdaptiveAnkiConfiguration} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 xl:items-end">
            <div className="md:col-span-2 xl:col-span-3">
              <div className="text-[11px] text-muted">Japanese vocabulary deck</div>
              {japaneseAnkiMappings.length === 0 ? (
                <p className="mt-1 text-[12px] text-amber-300">No Japanese decks are mapped yet. Add your vocabulary deck on the <Link href="/anki" className="underline">Anki mapping page</Link>.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {japaneseAnkiMappings.map((mapping) => <label key={mapping.id} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] ${/(?:rtk|kanji)/i.test(mapping.deckName) ? 'border-line text-muted' : 'border-violet-900/60 bg-violet-950/20'}`}>
                    <input name="adaptiveMappingIds" type="checkbox" value={mapping.id} defaultChecked={mapping.adaptiveNewCards || mapping.id === recommendedAdaptiveMappingId} />
                    {mapping.deckName}
                    {/(?:rtk|kanji)/i.test(mapping.deckName) && <span className="text-[10px] text-amber-300">kanji—leave off</span>}
                  </label>)}
                </div>
              )}
            </div>
            <label className="flex h-9 items-center gap-2 text-[12px]"><input name="enabled" type="checkbox" defaultChecked={japaneseAdaptiveAnki.enabled} />Adapt Japanese vocabulary new cards automatically</label>
            <label className="text-[11px] text-muted">Starting cards per day<input name="startingBudget" type="number" min="1" max="100" defaultValue={japaneseAdaptiveAnki.startingBudget} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Maximum cards per day<input name="maximumBudget" type="number" min="1" max="100" defaultValue={japaneseAdaptiveAnki.maximumBudget} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Target maximum review minutes<input name="targetReviewMinutes" type="number" min="10" max="240" defaultValue={japaneseAdaptiveAnki.targetReviewMinutes} className={`${inputCls} mt-1`} /></label>
            <label className="text-[11px] text-muted">Anki day starts at hour<input name="ankiDayStartHour" type="number" min="0" max="23" defaultValue={japaneseAdaptiveAnki.ankiDayStartHour} className={`${inputCls} mt-1`} /></label>
            <label className="flex h-9 items-center gap-2 text-[12px]"><input name="coldStartProtection" type="checkbox" defaultChecked={japaneseAdaptiveAnki.coldStartProtection} />Use conservative confidence ramp</label>
            <div className="xl:col-span-3"><button type="submit" className={btnPrimaryCls}>Save adaptive Anki settings</button></div>
          </form>
          <p className="mt-2 text-[11px] text-muted">Current budget: {adaptiveAnkiState?.currentBudget ?? japaneseAdaptiveAnki.startingBudget} new cards · {adaptiveAnkiState?.reliableDataDays ?? 0} reliable data days. Only checked vocabulary decks receive this limit.</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-muted">Reset adaptive history</summary>
            <form action={resetJapaneseAdaptiveAnki} className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[11px] text-muted"><input name="confirmReset" type="checkbox" required />Reset only adaptive evidence and decisions; keep all Anki history</label>
              <button type="submit" className={btnCls}>Reset controller</button>
            </form>
          </details>
        </Card>
        </div>
        <Card className="mt-3">
          <form action={updateJapaneseKanjiRepairConfiguration} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="flex h-9 items-center gap-2 text-[12px]"><input name="useVocabularyPerformance" type="checkbox" defaultChecked={japaneseKanjiRepair.useVocabularyPerformance} />Use vocabulary performance for Kanji Repair</label>
            <label className="text-[11px] text-muted">Repair cooldown days<input name="cooldownDays" type="number" min="1" max="90" defaultValue={japaneseKanjiRepair.cooldownDays} className={`${inputCls} mt-1`} /></label>
            <button type="submit" className={btnPrimaryCls}>Save Kanji Repair settings</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">Vocabulary-derived weakness is experimental and stays off unless enabled. Direct RTK-card evidence always remains the primary signal.</p>
        </Card>
      </Section>}

      {section === 'chinese' && <Section title="Chinese">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Link href="/chinese/mandarin-blueprint"><Card className="h-full hover:border-accent/50"><div className="font-medium">Mandarin Blueprint</div><p className="mt-1 text-[12px] text-muted">Complete levels and push their characters and words to Anki.</p></Card></Link>
          <Link href="/chinese/pronunciation"><Card className="h-full hover:border-accent/50"><div className="font-medium">Pronunciation</div><p className="mt-1 text-[12px] text-muted">Three-day tone-pair rotation from reviewed Anki vocabulary.</p></Card></Link>
          <Link href="/anki"><Card className="h-full hover:border-accent/50"><div className="font-medium">Anki mapping</div><p className="mt-1 text-[12px] text-muted">Deck sync and review data.</p></Card></Link>
          <Link href="/words?lang=zh"><Card className="h-full hover:border-accent/50"><div className="font-medium">Known words</div><p className="mt-1 text-[12px] text-muted">Chinese vocabulary sources and counts.</p></Card></Link>
        </div>
        <Card className="mt-3">
          <form action={updateMandarinBlueprintConfiguration} className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
            <label className="text-[11px] text-muted">Standard characters (word → character)<select name="characterDeckName" defaultValue={mandarin.characterDeckName} className={`${inputCls} mt-1`}>{mandarinDeckOptions.map((deckName) => <option key={deckName} value={deckName}>{deckName}</option>)}</select></label>
            <label className="text-[11px] text-muted">Reversed characters (character → word)<select name="reversedCharacterDeckName" defaultValue={mandarin.reversedCharacterDeckName} className={`${inputCls} mt-1`}>{mandarinDeckOptions.map((deckName) => <option key={deckName} value={deckName}>{deckName}</option>)}</select></label>
            <label className="text-[11px] text-muted">Words (word → details)<select name="wordDeckName" defaultValue={mandarin.wordDeckName} className={`${inputCls} mt-1`}>{mandarinDeckOptions.map((deckName) => <option key={deckName} value={deckName}>{deckName}</option>)}</select></label>
            <button className={btnPrimaryCls}>Save deck names</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">Each character creates both a word → character card and a character → word card. Word cards show the Mandarin word first, then pinyin, audio, and definitions.</p>
        </Card>
      </Section>}

      {section === 'math' && <Section title="Math goal">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <div className="text-[13px] font-medium">Long-term goals</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {mathTargets.map((target) => <form key={target.id} action={updateMathLongTermGoal} className="flex items-center overflow-hidden rounded-md border border-line bg-surface-2">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="targetSlug" value={target.slug} />
                <span className="px-2.5 py-1.5 text-[12px]">{target.title}</span>
                <button disabled={mathTargets.length === 1} aria-label={`Remove ${target.title}`} title={mathTargets.length === 1 ? 'Keep at least one long-term goal' : `Remove ${target.title}`} className="border-l border-line px-2 py-1.5 text-[12px] text-muted hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">×</button>
              </form>)}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] text-accent">Customize long-term goals</summary>
              <form action={updateMathLongTermGoal} className="mt-2 flex gap-2">
                <input type="hidden" name="intent" value="add" />
                <select name="targetSlug" required defaultValue="" disabled={availableMathTargets.length === 0} className={inputCls}>
                  <option value="" disabled>{availableMathTargets.length ? 'Choose a roadmap topic…' : 'Every roadmap topic is already added'}</option>
                  {availableMathTargets.map((target) => <option key={target.id} value={target.slug}>{target.title}</option>)}
                </select>
                <button disabled={availableMathTargets.length === 0} className={`${btnCls} disabled:opacity-40`}>Add</button>
              </form>
            </details>
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
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
