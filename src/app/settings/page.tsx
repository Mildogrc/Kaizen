import { prisma } from '@/lib/db';
import { Card, PageHeader, Section } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await prisma.user.findFirst();
  const settings = (user?.settings ?? {}) as Record<string, unknown>;

  return (
    <>
      <PageHeader title="Settings" subtitle="Single-user, local-first. Data lives in your local PostgreSQL." />

      <Section title="Profile">
        <Card className="text-[13px]">
          <div className="grid grid-cols-[140px_1fr] gap-y-1.5">
            <span className="text-muted">Name</span><span>{user?.name}</span>
            <span className="text-muted">Email</span><span>{user?.email}</span>
          </div>
        </Card>
      </Section>

      <Section title="Study defaults">
        <Card className="text-[13px]">
          <div className="grid grid-cols-[180px_1fr] gap-y-1.5">
            <span className="text-muted">New cards / day</span><span>{String(settings.dailyNewCards ?? 20)}</span>
            <span className="text-muted">Review cap / day</span><span>{String(settings.dailyReviewCap ?? 200)}</span>
            <span className="text-muted">Default study mode</span><span>{String(settings.defaultStudyMode ?? 'balanced')}</span>
          </div>
          <p className="mt-3 text-[11px] text-muted">Editable settings UI arrives with the scheduler in Phase 2.</p>
        </Card>
      </Section>

      <Section title="Data">
        <Card className="text-[12px] text-muted leading-relaxed">
          <p>Database: <code className="text-foreground">hyperlearning</code> on local PostgreSQL (see <code>.env</code>).</p>
          <p className="mt-1">Full data export / course export ships in Phase 4; per-schema JSON export is available now on each schema page.</p>
        </Card>
      </Section>
    </>
  );
}
