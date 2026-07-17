import Link from 'next/link';
import { prisma } from '@/lib/db';
import { maybeRecomputeStats } from '@/lib/known-words-sync';
import { unionBounds, type UnionEntry } from '@/lib/known-words';
import { addManualWord, deleteKnownWord } from '@/lib/actions';
import { Badge, Card, EmptyState, PageHeader, Section, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { BandLine } from '@/components/anki-charts';
import { WordsImport } from './words-import';

export const dynamic = 'force-dynamic';

const LANG_LABEL: Record<string, string> = { ja: 'Japanese', zh: 'Chinese' };

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lang?: string; source?: string }>;
}) {
  const { q, lang, source } = await searchParams;
  await maybeRecomputeStats();

  const [allWords, stats] = await Promise.all([
    prisma.knownWord.findMany({
      select: { strictKey: true, looseKey: true, reading: true, source: true, language: true },
    }),
    prisma.knownWordStat.findMany({ orderBy: { date: 'asc' } }),
  ]);

  const perLanguage = (['ja', 'zh'] as const).map((language) => {
    const entries = allWords.filter((w) => w.language === language);
    return { language, count: entries.length, bounds: unionBounds(entries as UnionEntry[]) };
  });

  const words = await prisma.knownWord.findMany({
    where: {
      ...(lang === 'ja' || lang === 'zh' ? { language: lang } : {}),
      ...(source ? { source } : {}),
      ...(q
        ? { OR: [{ surface: { contains: q } }, { lemma: { contains: q } }, { reading: { contains: q } }] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const filterLink = (params: Record<string, string | undefined>) => {
    const merged = { q, lang, source, ...params };
    const search = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&');
    return search ? `/words?${search}` : '/words';
  };

  return (
    <>
      <PageHeader
        title="Known Words"
        subtitle="Union of Migaku, mature Anki cards, and manual adds — conjugations deduped, bounds when merging is uncertain"
      />

      {/* Per-language bounds */}
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {perLanguage.map(({ language, bounds }) => (
          <Card key={language} className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted">{LANG_LABEL[language]} known words</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {bounds.lower === bounds.upper ? bounds.lower : `${bounds.lower}–${bounds.upper}`}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted tabular-nums">
              <span>migaku {bounds.bySource.migaku ?? 0}</span>
              <span>anki {bounds.bySource.anki ?? 0}</span>
              <span>manual {bounds.bySource.manual ?? 0}</span>
              {bounds.overlap > 0 && <span>overlap {bounds.overlap}</span>}
            </div>
          </Card>
        ))}
      </div>

      <WordsImport />

      <Section title="Add a single word">
        <Card>
          <form action={addManualWord} className="flex flex-wrap items-center gap-2">
            <input name="word" required placeholder="Word (e.g. 食べる or 电视)" className={`${inputCls} max-w-xs`} />
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="radio" name="language" value="ja" defaultChecked /> Japanese
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="radio" name="language" value="zh" /> Chinese
            </label>
            <button type="submit" className={btnPrimaryCls}>Add</button>
          </form>
        </Card>
      </Section>

      <Section title="Known words over time">
        <div className="grid gap-3 md:grid-cols-2">
          {(['ja', 'zh'] as const).map((language) => (
            <Card key={language}>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">{LANG_LABEL[language]}</div>
              <BandLine
                points={stats
                  .filter((s) => s.language === language)
                  .map((s) => ({ date: s.date.toISOString().slice(0, 10), lower: s.lower, upper: s.upper }))}
              />
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title={`Words (${words.length}${words.length === 200 ? '+' : ''})`}
        actions={
          <form action="/words" className="flex items-center gap-1.5">
            {lang && <input type="hidden" name="lang" value={lang} />}
            {source && <input type="hidden" name="source" value={source} />}
            <input name="q" defaultValue={q ?? ''} placeholder="Search…" className={`${inputCls} w-44 py-1`} />
          </form>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1.5 text-[12px]">
          <Link href={filterLink({ lang: undefined })} className={`${btnCls} ${!lang ? 'border-accent/60 text-accent' : ''}`}>all languages</Link>
          <Link href={filterLink({ lang: 'ja' })} className={`${btnCls} ${lang === 'ja' ? 'border-accent/60 text-accent' : ''}`}>Japanese</Link>
          <Link href={filterLink({ lang: 'zh' })} className={`${btnCls} ${lang === 'zh' ? 'border-accent/60 text-accent' : ''}`}>Chinese</Link>
          <span className="w-2" />
          <Link href={filterLink({ source: undefined })} className={`${btnCls} ${!source ? 'border-accent/60 text-accent' : ''}`}>all sources</Link>
          <Link href={filterLink({ source: 'migaku' })} className={`${btnCls} ${source === 'migaku' ? 'border-accent/60 text-accent' : ''}`}>migaku</Link>
          <Link href={filterLink({ source: 'anki' })} className={`${btnCls} ${source === 'anki' ? 'border-accent/60 text-accent' : ''}`}>anki</Link>
          <Link href={filterLink({ source: 'manual' })} className={`${btnCls} ${source === 'manual' ? 'border-accent/60 text-accent' : ''}`}>manual</Link>
        </div>
        {words.length === 0 ? (
          <EmptyState>No words match. Import a Migaku export or pull mature Anki cards above.</EmptyState>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2">Word</th>
                  <th className="px-3 py-2">Lemma</th>
                  <th className="px-3 py-2">Reading</th>
                  <th className="px-3 py-2">Lang</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Added</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {words.map((w) => (
                  <tr key={w.id} className="border-b border-line/50">
                    <td className="px-3 py-1.5 text-[14px]">{w.surface}</td>
                    <td className="px-3 py-1.5 text-muted">{w.lemma !== w.surface ? w.lemma : ''}</td>
                    <td className="px-3 py-1.5 text-muted">{w.reading ?? ''}</td>
                    <td className="px-3 py-1.5"><Badge>{w.language}</Badge></td>
                    <td className="px-3 py-1.5"><Badge tone={w.source === 'anki' ? 'blue' : w.source === 'migaku' ? 'purple' : 'neutral'}>{w.source}</Badge></td>
                    <td className="px-3 py-1.5 text-muted tabular-nums">{w.createdAt.toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-1.5">
                      <form action={deleteKnownWord.bind(null, w.id)}>
                        <button type="submit" className="text-muted hover:text-red-400 cursor-pointer" title="Delete word">✕</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </>
  );
}
