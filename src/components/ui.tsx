import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ?? 'mb-6'}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </Card>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-surface-2 text-muted',
  blue: 'bg-blue-950 text-blue-300',
  green: 'bg-green-950 text-green-300',
  amber: 'bg-amber-950 text-amber-300',
  red: 'bg-red-950 text-red-300',
  purple: 'bg-purple-950 text-purple-300',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ pct, color = 'var(--accent)' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
      {children}
    </div>
  );
}

export const inputCls =
  'w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none';

export const btnCls =
  'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] font-medium hover:border-accent/50 hover:text-white transition-colors cursor-pointer';

export const btnPrimaryCls =
  'inline-flex items-center gap-1.5 rounded-md bg-accent/15 border border-accent/40 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/25 transition-colors cursor-pointer';

export function statusTone(status: string): keyof typeof BADGE_TONES {
  switch (status) {
    case 'ACTIVE':
    case 'READING':
    case 'IN_PROGRESS':
      return 'blue';
    case 'COMPLETED':
    case 'FINISHED':
      return 'green';
    case 'PLANNED':
    case 'WANT_TO_READ':
      return 'neutral';
    case 'PAUSED':
      return 'amber';
    case 'ABANDONED':
      return 'red';
    default:
      return 'neutral';
  }
}

export function fmtStatus(s: string) {
  return s.toLowerCase().replace(/_/g, ' ');
}
