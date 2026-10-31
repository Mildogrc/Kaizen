// Navigation (sidebar + command palette). `api` is prefetched on hover.
export const NAV = [
  {
    group: 'Today',
    items: [
      { href: '/', label: 'Dashboard', glyph: '◧', api: '/dashboard', end: true },
      { href: '/daily', label: 'Daily', glyph: '☀', api: '/daily' },
      { href: '/review', label: 'Review', glyph: '↻', api: '/review' },
    ],
  },
  {
    group: 'Learn',
    items: [
      { href: '/japanese', label: 'Japanese', glyph: '日', api: '/courses/japanese' },
      { href: '/chinese', label: 'Chinese', glyph: '中', api: '/courses/chinese' },
      { href: '/math', label: 'Math', glyph: '∑', api: '/math' },
      { href: '/concepts', label: 'Concepts', glyph: '◇', api: '/concepts' },
      { href: '/skills', label: 'Skills', glyph: '⌨', api: '/skills' },
      { href: '/books', label: 'Books', glyph: '❦', api: '/books' },
    ],
  },
  {
    group: 'Track',
    items: [
      { href: '/analytics', label: 'Analytics', glyph: '∿', api: '/analytics' },
      { href: '/words', label: 'Known words', glyph: '語', api: '/words' },
      { href: '/mistakes', label: 'Mistakes', glyph: '⚑', api: '/mistakes' },
      { href: '/anki', label: 'Anki', glyph: '★', api: '/anki' },
    ],
  },
  {
    group: 'Content',
    items: [
      { href: '/import', label: 'Import', glyph: '⇥', api: '/import' },
      { href: '/schemas', label: 'Schemas', glyph: '⬡', api: '/schemas' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { href: '/configurations', label: 'Configurations', glyph: '◫', api: '/configurations' },
      { href: '/settings', label: 'Settings', glyph: '⚙', api: '/settings/ai' },
    ],
  },
];

/** Deeper pages reachable from the palette. */
export const EXTRA_PAGES = [
  { href: '/japanese/grammar', label: 'Japanese grammar coach', glyph: '文' },
  { href: '/japanese/kanji-repair', label: 'Kanji repair', glyph: '漢' },
  { href: '/chinese/mandarin-blueprint', label: 'Mandarin Blueprint', glyph: '蓝' },
  { href: '/chinese/pronunciation', label: 'Mandarin pronunciation', glyph: '声' },
  { href: '/nato', label: 'NATO alphabet', glyph: 'Ⓝ' },
  { href: '/codeforces', label: 'Codeforces', glyph: '</>' },
  { href: '/speed-reading', label: 'Speed reading', glyph: '»' },
  { href: '/youtube', label: 'YouTube playlists', glyph: '▶' },
  { href: '/schemas/new', label: 'New schema', glyph: '+' },
];
