import { useSearchParams } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { del, post, useApi } from '../lib/api';
import { date, num } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { BandChart } from '../components/charts';
import { Icon } from '../components/icons';
import { INSIGHTS_TABS } from '../lib/nav';
import { Badge, Card, Disclosure, Field, Load, Page, Pills, Section, Toggle , SubNav } from '../components/ui';

const LANG = { ja: 'Japanese', zh: 'Chinese' };

function MigakuImport() {
  const [language, setLanguage] = createSignal('ja');
  const [text, setText] = createSignal('');
  const [learning, setLearning] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const onFile = async (e) => { const f = e.currentTarget.files?.[0]; if (f) setText(await f.text()); };
  const run = async () => {
    setBusy(true);
    const r = await attempt(() => post('/words/migaku', { language: language(), text: text(), includeLearning: learning() }));
    setBusy(false);
    if (r) { toast(`Added ${num(r.summary.added)} words (${num(r.summary.duplicates)} already known, ${r.summary.unparseable} unreadable)`, 'good'); setText(''); }
  };
  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-4">
        <Pills value={language()} onChange={setLanguage} options={[{ value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }]} />
        <Toggle checked={learning()} onChange={setLearning} label="Include “learning” words" />
      </div>
      <input type="file" accept=".json,.csv,.txt" class="input py-1.5" onChange={onFile} />
      <textarea class="input min-h-32 font-mono text-[12px]" value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder="…or paste the Migaku export (JSON or CSV)" />
      <button class="btn btn-primary" disabled={busy() || !text().trim()} onClick={run}>{busy() ? 'Importing…' : 'Import words'}</button>
    </div>
  );
}

export default function Words() {
  const [params, setParams] = useSearchParams();
  const key = () => `/words?${new URLSearchParams(Object.entries({ q: params.q, lang: params.lang, source: params.source }).filter(([, v]) => v))}`;
  const q = useApi(key);
  const [word, setWord] = createSignal('');
  const [wordLang, setWordLang] = createSignal('ja');
  const [search, setSearch] = createSignal(params.q ?? '');
  const [refreshing, setRefreshing] = createSignal(false);
  let debounce;
  const onSearch = (value) => { setSearch(value); clearTimeout(debounce); debounce = setTimeout(() => setParams({ q: value || undefined }), 250); };
  const refreshAnki = async () => {
    setRefreshing(true);
    await attempt(() => post('/words/anki'), (r) => `Scanned ${num(r.summary.scanned)} mature cards: ${num(r.summary.added)} added, ${num(r.summary.removed)} removed`);
    setRefreshing(false);
  };
  const add = async (e) => {
    e.preventDefault();
    if (await attempt(() => post('/words', { word: word(), language: wordLang() }), 'Word added')) setWord('');
  };
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Insights" subtitle="Words from Migaku, older Anki cards, and ones you added. Forms of one word count once; a range means some merges are uncertain."
          actions={<button class="btn" disabled={refreshing()} onClick={refreshAnki}><Icon name="sync" size={14} class={refreshing() ? 'animate-spin' : ''} /> Count Anki cards again</button>}>
          <SubNav label="Insights" items={INSIGHTS_TABS} />
          <div class="mb-6 grid gap-3 md:grid-cols-2">
            <For each={d.languages}>
              {(l) => (
                <Card>
                  <div class="text-[11px] font-medium uppercase tracking-wider text-muted">{LANG[l.language]}</div>
                  <div class="tnum mt-1 text-[22px] font-semibold"><span title={l.lower === l.upper ? undefined : `${num(l.lower)}–${num(l.upper)}`}>~{num(l.lower)}</span></div>
                  <div class="tnum mt-1 flex flex-wrap gap-x-4 text-[12px] text-muted">
                    <span>Migaku {num(l.bySource.migaku ?? 0)}</span><span>Anki {num(l.bySource.anki ?? 0)}</span><span>manual {num(l.bySource.manual ?? 0)}</span>
                    <Show when={l.overlap}><span>overlap {num(l.overlap)}</span></Show>
                  </div>
                  <div class="mt-3"><BandChart points={d.history.find((h) => h.language === l.language)?.points ?? []} height={110} /></div>
                </Card>
              )}
            </For>
          </div>
          <div class="mb-6 grid gap-3 lg:grid-cols-2">
            <Card>
              <div class="mb-2 text-[13px] font-semibold">Add a word</div>
              <form onSubmit={add} class="flex flex-wrap items-center gap-2">
                <input class="input max-w-[220px]" required value={word()} onInput={(e) => setWord(e.currentTarget.value)} placeholder="食べる or 电视" />
                <Pills value={wordLang()} onChange={setWordLang} options={[{ value: 'ja', label: '日' }, { value: 'zh', label: '中' }]} />
                <button class="btn btn-primary">Add</button>
              </form>
            </Card>
            <Disclosure title="Import a Migaku export"><MigakuImport /></Disclosure>
          </div>
          <Section title={`Words (${d.words.length}${d.words.length === 200 ? '+' : ''})`}
            actions={<input class="input h-8 w-52" value={search()} onInput={(e) => onSearch(e.currentTarget.value)} placeholder="Search…" />}>
            <div class="mb-3 flex flex-wrap gap-4">
              <Pills value={params.lang ?? ''} onChange={(v) => setParams({ lang: v || undefined })} options={[{ value: '', label: 'All languages' }, { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }]} />
              <Pills value={params.source ?? ''} onChange={(v) => setParams({ source: v || undefined })} options={[{ value: '', label: 'All sources' }, { value: 'migaku', label: 'Migaku' }, { value: 'anki', label: 'Anki' }, { value: 'manual', label: 'Manual' }]} />
            </div>
            <Card pad={false} class="overflow-x-auto">
              <table class="w-full text-left text-[13px]">
                <thead class="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <tr><th class="px-3 py-2">Word</th><th class="px-3 py-2">Lemma</th><th class="px-3 py-2">Reading</th><th class="px-3 py-2">Source</th><th class="px-3 py-2">Added</th><th /></tr>
                </thead>
                <tbody class="divide-y divide-line">
                  <For each={d.words} fallback={<tr><td colspan="6" class="px-3 py-6 text-center text-muted">No words match.</td></tr>}>
                    {(w) => (
                      <tr class="hover:bg-surface-2/60">
                        <td class="px-3 py-1.5 text-[14px]">{w.surface}</td>
                        <td class="px-3 py-1.5">{w.lemma}</td>
                        <td class="px-3 py-1.5 text-muted">{w.reading ?? ''}</td>
                        <td class="px-3 py-1.5"><Badge tone={w.source === 'anki' ? 'info' : w.source === 'migaku' ? 'accent' : 'neutral'}>{w.source}</Badge> <span class="text-[11px] text-muted">{w.sourceDetail ?? ''}</span></td>
                        <td class="px-3 py-1.5 text-muted">{date(w.createdAt)}</td>
                        <td class="px-2 py-1.5 text-right"><button class="btn btn-ghost btn-sm text-muted" title="Remove" onClick={() => attempt(() => del(`/words/${w.id}`))}><Icon name="trash" size={13} /></button></td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Card>
          </Section>
        </Page>
      )}
    </Load>
  );
}
