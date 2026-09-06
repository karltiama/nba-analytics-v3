import type { ReactNode } from 'react';
import { rollupHealthStatus } from '@/lib/ops/health-status';
import type { HealthStatus } from '@/lib/ops/health-status';
import type { PlatformHealthReport } from '@/lib/ops/platform-health';

const STATUS_CLASS: Record<HealthStatus, string> = {
  HEALTHY: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  FROZEN_EXPECTED: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  UNKNOWN: 'text-zinc-400 border-white/10 bg-white/5',
  STALE: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  DEGRADED: 'text-orange-300 border-orange-500/30 bg-orange-500/10',
  FAILED: 'text-red-400 border-red-500/30 bg-red-500/10',
};

function Badge({ status }: { status: HealthStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${STATUS_CLASS[status]}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function Card({
  title,
  status,
  children,
}: {
  title: string;
  status: HealthStatus;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <Badge status={status} />
      </header>
      {children}
    </section>
  );
}

function fmtHours(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}h`;
}

export function PlatformHealthView({ report }: { report: PlatformHealthReport }) {
  const largest = report.database.largest[0];
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-muted-foreground">Internal · session required · not indexed</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-white tracking-tight">Data Platform Health</h1>
          <Badge status={report.overall} />
        </div>
        <p className="text-sm text-muted-foreground">
          Generated {report.generatedAt}. Freeze: DATA_MODE={report.freeze.dataMode},
          OFFSEASON={report.freeze.offseason ? '1' : '0'}, CRON_DRY_RUN=
          {report.freeze.cronDryRun ? '1' : '0'}.
        </p>
      </header>

      <Card title="Database" status={report.database.status}>
        <p className="text-sm text-white/80">
          Size: {report.database.sizePretty ?? 'unknown'}
          {largest ? ` · Largest: ${largest.name} (${largest.sizePretty})` : ''}
        </p>
        <ul className="text-xs text-muted-foreground grid sm:grid-cols-2 gap-1">
          {report.database.rowCounts.map((row) => (
            <li key={row.name}>
              {row.name}: {row.rows == null ? '—' : row.rows.toLocaleString()}
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Ingestion"
        status={rollupHealthStatus(
          report.ingestion.filter((row) => row.tracked).map((row) => row.status)
        )}
      >
        <ul className="space-y-2 text-sm">
          {report.ingestion.map((row) => (
            <li key={row.source} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-white capitalize">{row.source}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge status={row.status} />
                {row.reason}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Injury serving" status={report.injuryServing.status}>
        <p className="text-sm text-white/80">
          Latest snapshot: {report.injuryServing.latestSnapshotAt ?? '—'} · age{' '}
          {fmtHours(report.injuryServing.ageHours)} ·{' '}
          {report.injuryServing.authoritative ? 'authoritative' : 'not authoritative'}
        </p>
        <p className="text-xs text-muted-foreground">{report.injuryServing.reason}</p>
      </Card>

      <Card
        title="Lifecycle / archive"
        status={rollupHealthStatus(report.archives.map((row) => row.status))}
      >
        <ul className="space-y-2 text-sm">
          {report.archives.map((row) => (
            <li key={row.entity} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white">{row.entity}</span>
                <Badge status={row.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                status={row.manifestStatus ?? '—'} · records=
                {row.recordCount == null ? '—' : row.recordCount.toLocaleString()} · partitions=
                {row.partitionCount ?? '—'} · exported={row.exportedAt ?? '—'}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground pt-1">{report.s3.note}</p>
      </Card>

      <Card title="Coverage" status={rollupHealthStatus(report.coverage.map((row) => row.status))}>
        <ul className="space-y-1 text-sm">
          {report.coverage.map((row) => (
            <li key={row.kind} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white">{row.kind.replaceAll('_', ' ')}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                unresolved {row.unresolved ?? '—'}
                <Badge status={row.status} />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Last prune" status={report.prune.status}>
        <p className="text-sm text-white/80">{report.prune.reason}</p>
        <p className="text-xs text-muted-foreground">{report.prune.note}</p>
      </Card>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h2 className="text-sm font-semibold text-white">Warning thresholds (visibility only)</h2>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>
            Live ingest stale: props {report.thresholds.liveIngestStaleHours.props}h, odds{' '}
            {report.thresholds.liveIngestStaleHours.odds}h, injuries{' '}
            {report.thresholds.liveIngestStaleHours.injuries}h
          </li>
          <li>Stuck started: {report.thresholds.stuckStartedMinutes}m</li>
          <li>
            Unexpected ingest while frozen: {report.thresholds.unexpectedIngestWhileFrozenHours}h
          </li>
          <li>Coverage unresolved warn above {report.thresholds.coverageUnresolvedWarnAbove}</li>
          <li>
            DB plan percent warn: {report.thresholds.dbPlanPercentWarn}% of the hosting gauge (not
            auto-measured)
          </li>
        </ul>
      </section>
    </main>
  );
}
