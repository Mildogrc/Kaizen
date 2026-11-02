// Navigation (sidebar + command palette). `api` is prefetched on hover.
export const NAV = [
  { href: '/', label: 'Today', glyph: '◧', api: '/today', end: true },
  { href: '/review', label: 'Review', glyph: '↻', api: '/review/summary', count: true },
  { href: '/tracks', label: 'Tracks', glyph: '◎', api: '/tracks', also: ['/concepts'] },
  { href: '/library', label: 'Library', glyph: '▶', api: '/youtube' },
  { href: '/insights', label: 'Insights', glyph: '∿', api: '/analytics' },
];

export const SETTINGS_NAV = { href: '/settings', label: 'Settings', glyph: '⚙', api: '/settings/ai' };

/** Deeper pages reachable from the palette. */
export const EXTRA_PAGES = [
  { href: '/tracks/japanese', label: 'Japanese', glyph: '日' },
  { href: '/tracks/chinese', label: 'Chinese', glyph: '中' },
  { href: '/tracks/math', label: 'Mathematics', glyph: '∑' },
  { href: '/concepts', label: 'Concepts', glyph: '◇' },
  { href: '/tracks/japanese/grammar', label: 'Grammar coach', glyph: '文' },
  { href: '/tracks/japanese/character-repair', label: 'Character repair', glyph: '漢' },
  { href: '/tracks/chinese/mandarin-blueprint', label: 'Mandarin Blueprint', glyph: '蓝' },
  { href: '/tracks/chinese/tones', label: 'Tone practice', glyph: '声' },
  { href: '/tracks/nato', label: 'NATO alphabet', glyph: 'Ⓝ' },
  { href: '/tracks/codeforces', label: 'Codeforces', glyph: '</>' },
  { href: '/tracks/speed-reading', label: 'Speed reading', glyph: '»' },
  { href: '/tracks/reading', label: 'Reading', glyph: '❦' },
  { href: '/library/books', label: 'Books', glyph: '❦' },
  { href: '/library/imports', label: 'Imports', glyph: '⇥' },
  { href: '/insights/words', label: 'Known words', glyph: '語' },
  { href: '/insights/mistakes', label: 'Mistakes', glyph: '⚑' },
  { href: '/settings/anki', label: 'Anki connection', glyph: '★' },
  { href: '/settings/data', label: 'Your data', glyph: '⬡' },
  { href: '/schemas', label: 'Content types', glyph: '⬡' },
  { href: '/configurations', label: 'Study settings', glyph: '◫' },
];

export const LIBRARY_TABS = [
  { href: '/library', label: 'Courses' },
  { href: '/library/books', label: 'Books' },
  { href: '/library/imports', label: 'Imports' },
];

export const INSIGHTS_TABS = [
  { href: '/insights', label: 'Overview' },
  { href: '/insights/words', label: 'Known words' },
  { href: '/insights/mistakes', label: 'Mistakes' },
];

export const SETTINGS_TABS = [
  { href: '/settings', label: 'Account and AI' },
  { href: '/settings/anki', label: 'Anki' },
  { href: '/settings/data', label: 'Data' },
];
