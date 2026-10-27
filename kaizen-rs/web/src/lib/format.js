const nf = new Intl.NumberFormat();
export const num = (n) => (n == null || Number.isNaN(n) ? '—' : nf.format(n));
export const pct = (fraction, digits = 0) => (fraction == null ? '—' : `${(fraction * 100).toFixed(digits)}%`);
export const pctValue = (value, digits = 0) => (value == null ? '—' : `${Number(value).toFixed(digits)}%`);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function date(value, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, opts);
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relative(value) {
  if (!value) return 'never';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
  const sizes = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  const [, unit] = steps.find(([limit]) => abs < limit);
  return rtf.format(-Math.round(diff / sizes[unit]), unit);
}

export function duration(seconds) {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const plural = (n, word, many = `${word}s`) => `${num(n)} ${n === 1 ? word : many}`;
export const titleCase = (s) => (s ?? '').toLowerCase().replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replace(/_/g, ' ');
