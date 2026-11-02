import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { Badge, Progress } from './ui';

const KIND_LABEL = { language: 'Language', exam: 'Exam', course: 'Course', practice: 'Practice', reading: 'Reading' };

export function TrackCard(props) {
  const t = () => props.track;
  return (
    <A href={t().href} class="card kz-track">
      <div class="kz-track__top">
        <span class="kz-glyph" lang={t().lang ?? undefined}>{t().glyph}</span>
        <div class="min-w-0">
          <div class="kz-track__name truncate">{t().name}</div>
          <div class="kz-track__goal truncate">{t().goal}</div>
        </div>
        <Badge class="kz-track__kind">{KIND_LABEL[t().kind]}</Badge>
      </div>
      <div title={t().tooltip ?? undefined}>
        <div class="kz-track__headline">{t().headline}</div>
        <div class="kz-track__meaning">{t().meaning}</div>
      </div>
      <Show when={t().progress > 0}><Progress value={t().progress} color={t().color} /></Show>
      <Show when={t().next}><div class="kz-track__next"><span class="min-w-0 truncate"><b>Next:</b> {t().next}</span></div></Show>
    </A>
  );
}

/** A language framework's levels: which are done, how far into the current one. */
export function LevelLadder(props) {
  return (
    <div class="kz-ladder">
      <For each={props.levels}>
        {(l) => (
          <div class="kz-level" data-done={l.complete || undefined} data-current={l.current || undefined}>
            <div class="kz-level__name">{l.label}<Show when={l.complete}><span>✓</span></Show></div>
            <Progress class="mt-2" value={l.primary} color="var(--info)" />
            <Show when={l.secondary != null}><Progress class="mt-1" value={l.secondary} color="var(--grammar)" /></Show>
            <div class="kz-level__pct">{Math.round(l.primary)}%{l.secondary != null ? ` · ${Math.round(l.secondary)}%` : ''}</div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Coverage by subject, read from the deck's tag tree. */
export function Coverage(props) {
  return (
    <>
      <div class="kz-coverage">
        <For each={props.rows}>
          {(r) => (
            <>
              <span class="truncate" title={r.tag}>{r.name}</span>
              <div class="kz-coverage__bar" role="img" aria-label={`${r.name}: ${Math.round(r.unlockedPct)}% unlocked, ${Math.round(r.maturePct)}% mature`}>
                <span class="unlocked" style={{ width: `${r.unlockedPct}%` }} />
                <span class="mature" style={{ width: `${r.maturePct}%` }} />
              </div>
              <span class="kz-coverage__pct">{Math.round(r.unlockedPct)}% · {Math.round(r.maturePct)}%</span>
            </>
          )}
        </For>
      </div>
      <div class="kz-legend">
        <span><i style={{ background: 'color-mix(in srgb, var(--accent) 35%, var(--surface-3))' }} />Unlocked</span>
        <span><i style={{ background: 'var(--accent)' }} />Mature (21+ days)</span>
      </div>
    </>
  );
}

/** One lesson: number, title, length, and state. */
export function LessonRow(props) {
  return (
    <div class="kz-lesson" data-done={props.done || undefined} data-current={props.current || undefined}>
      <span class="kz-lesson__n">{props.done ? '✓' : props.number}</span>
      <div class="kz-lesson__body">
        <div class="kz-lesson__title" title={props.title}>{props.title}</div>
        <Show when={props.meta}><div class="kz-lesson__meta">{props.meta}</div></Show>
        {props.below}
      </div>
      {props.children}
    </div>
  );
}
