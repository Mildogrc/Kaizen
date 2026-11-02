import { A } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { num } from '../lib/format';
import { toast } from '../lib/store';
import { Badge, Card, Empty, Load, Metric, MetricRow, Page, Pills, Progress } from '../components/ui';

const STATUS = { pushed: ['good', 'in Anki'], failed: ['bad', 'push failed'], completed: ['warn', 'completed'], current: ['accent', 'current'], ready: ['neutral', 'upcoming'] };

function Level(props) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const l = props.level;
  const complete = async () => {
    setBusy(true);
    try {
      const r = await post(`/chinese/mandarin-blueprint/${l.level}/complete`);
      toast(r.message, 'good');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card class={l.status === 'current' ? 'border-accent/50' : l.status === 'pushed' ? 'border-good/30' : ''}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[15px] font-semibold">Level {l.level}</div>
          <div class="text-[12px] text-muted">Phase {l.phase ?? '—'} · {l.characters.length} characters · {l.words.length} words</div>
        </div>
        <Badge tone={STATUS[l.status][0]}>{STATUS[l.status][1]}</Badge>
      </div>
      <button class="mt-2 text-[12px] font-medium text-accent-text hover:underline" onClick={() => setOpen(!open())}>{open() ? 'Hide content' : 'Preview content'}</button>
      <Show when={open()}>
        <div class="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-2 p-2.5 text-[13px] leading-relaxed">
          <div><span class="text-[11px] text-muted">Characters </span>{l.characters.join(' ') || '—'}</div>
          <div class="mt-1.5"><span class="text-[11px] text-muted">Words </span>{l.words.join(' · ') || '—'}</div>
        </div>
      </Show>
      <Show when={l.pushError}><div class="mt-2 rounded-lg bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad">{l.pushError}</div></Show>
      <div class="mt-3">
        <button class={l.status === 'pushed' ? 'btn btn-sm' : 'btn btn-primary btn-sm'} disabled={busy()} onClick={complete}>
          {busy() ? 'Adding to Anki…' : l.status === 'pushed' ? 'Re-push new cards' : l.completedAt ? 'Retry push to Anki' : 'Complete level → Anki'}
        </button>
      </div>
    </Card>
  );
}

export default function Mandarin() {
  const q = useApi(() => '/chinese/mandarin-blueprint');
  const [filter, setFilter] = createSignal('upcoming');
  return (
    <Load q={q}>
      {(d) => {
        const shown = () => d.levels.filter((l) => filter() === 'all' || (filter() === 'done' ? l.completedAt : !l.completedAt));
        return (
          <Page title="Mandarin Blueprint" glyph="蓝" back={{ href: '/tracks/chinese', label: 'Chinese' }}
            subtitle="Finish a course level, cache its dictionary data, and push new characters and words to Anki"
            actions={<A href="/configurations?section=chinese" class="btn">Deck settings</A>}>
            <MetricRow class="sm:!grid-cols-2 lg:!grid-cols-2">
              <Metric noun="Levels finished" value={`${d.completed} of ${d.totalLevels}`} meaning="in Mandarin Blueprint" />
              <Metric noun="Sent to Anki" value={d.pushed} meaning="levels with their cards made" />
            </MetricRow>
            <div class="mb-5">
              <div class="mb-1 flex justify-between text-[12px] text-muted"><span>Course completion</span><span class="tnum">{Math.round((d.completed / d.totalLevels) * 100)}%</span></div>
              <Progress value={(d.completed / d.totalLevels) * 100} color="var(--video)" />
            </div>
            <Show when={d.levels.length} fallback={<Empty>Load the 88-level catalog once on the server: <code class="font-mono">kaizen import-mandarin --csv MandarinBluePrint.csv</code></Empty>}>
              <Pills class="mb-4" value={filter()} onChange={setFilter} options={[
                { value: 'upcoming', label: 'Upcoming', count: d.levels.length - d.completed },
                { value: 'done', label: 'Completed', count: d.completed },
                { value: 'all', label: 'All', count: d.levels.length },
              ]} />
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><For each={shown()}>{(l) => <Level level={l} />}</For></div>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
