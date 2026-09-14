export type ReconcileGameRun = {
  pullRunId: number;
  gameId: string;
  startedAt: string;
  rowsStored: number;
  rowsArchived: number;
  archiveObjectCount: number;
  archiveStatus: string;
  archiveKey: string | null;
  s3ObjectFound?: boolean | null;
};

export type PropArchiveReconcileReport = {
  from: string;
  to: string;
  gameRuns: number;
  rowsStored: number;
  rowsArchived: number;
  archiveObjects: number;
  archivedRuns: number;
  missingArchives: number;
  failedArchives: number;
  missing: ReconcileGameRun[];
  failed: ReconcileGameRun[];
};

export function utcDateOnly(isoOrDate: Date | string): string {
  const iso = typeof isoOrDate === 'string' ? isoOrDate : isoOrDate.toISOString();
  return iso.slice(0, 10);
}

export function parseReconcileArgs(argv: string[]): { from: string; to: string; checkS3: boolean } {
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const idx = argv.indexOf(name);
    if (idx >= 0) return argv[idx + 1];
    return undefined;
  };
  const date = get('--date');
  const from = get('--from') ?? date;
  const to = get('--to') ?? date;
  if (!from || !to) {
    throw new Error('Usage: npm run reconcile:prop-archive -- --date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD');
  }
  return { from, to, checkS3: argv.includes('--s3') };
}

export function summarizePropArchiveReconciliation(
  rows: ReconcileGameRun[],
  range: { from: string; to: string }
): PropArchiveReconcileReport {
  const missing: ReconcileGameRun[] = [];
  const failed: ReconcileGameRun[] = [];
  let rowsStored = 0;
  let rowsArchived = 0;
  let archiveObjects = 0;
  let archivedRuns = 0;
  for (const row of rows) {
    rowsStored += row.rowsStored;
    rowsArchived += row.rowsArchived;
    archiveObjects += row.archiveObjectCount;
    if (row.archiveStatus === 'archived' && row.s3ObjectFound !== false) {
      archivedRuns += 1;
    }
    if (row.archiveStatus === 'failed') failed.push(row);
    const missingTape =
      row.rowsStored > 0 &&
      (row.archiveStatus !== 'archived' || row.s3ObjectFound === false);
    if (missingTape) missing.push(row);
  }
  return {
    from: range.from,
    to: range.to,
    gameRuns: rows.length,
    rowsStored,
    rowsArchived,
    archiveObjects,
    archivedRuns,
    missingArchives: missing.length,
    failedArchives: failed.length,
    missing,
    failed,
  };
}

export function formatPropArchiveReconcileReport(report: PropArchiveReconcileReport): string {
  const label = report.from === report.to ? report.from : `${report.from} .. ${report.to}`;
  return [
    `Date: ${label}`,
    '',
    `game runs:          ${report.gameRuns}`,
    `rows stored:        ${report.rowsStored.toLocaleString('en-US')}`,
    `rows archived:      ${report.rowsArchived.toLocaleString('en-US')}`,
    `archive objects:    ${report.archiveObjects}`,
    `missing archives:   ${report.missingArchives}`,
    `failed archives:    ${report.failedArchives}`,
  ].join('\n');
}

export const RECONCILE_GAME_RUNS_SQL = `
  SELECT
    pull_run_id,
    game_id,
    started_at,
    coalesce(rows_stored, 0) AS rows_stored,
    coalesce(rows_archived, 0) AS rows_archived,
    coalesce(archive_object_count, 0) AS archive_object_count,
    coalesce(archive_status, 'pending') AS archive_status,
    archive_key
  FROM raw.player_prop_game_runs
  WHERE started_at >= $1::date
    AND started_at < ($2::date + interval '1 day')
  ORDER BY started_at, pull_run_id, game_id
`;
