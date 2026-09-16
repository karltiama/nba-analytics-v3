/**
 * Collector persistence plan for injury pulls.
 * Writes extra membership/health only when the unapplied schema is present.
 */

import {
  assertSchemaReady,
  inspectInjuryCollectionSchema,
  readCollectionSchemaMode,
  withSavepoint,
  type CollectionSchemaMode,
  type SqlQueryable,
} from '@/lib/db/schema-capability';
import { evaluateInjuryPullCompleteness } from './leave-report';
import { planInjuryPullMembership, type InjuryMembershipRow } from './ingest-plan';

export type InjuryPullHealthClass = 'ok' | 'degraded_failed_latest' | 'incomplete_latest';

export function injuryPullHealthClass(args: {
  status: string;
  complete: boolean;
}): InjuryPullHealthClass {
  if ((args.status || '').toLowerCase() === 'error' || (args.status || '').toLowerCase() !== 'success') {
    return 'degraded_failed_latest';
  }
  return args.complete ? 'ok' : 'incomplete_latest';
}

export function planInjuryCollectorExtras(args: {
  pullRunId: number;
  observedAt: string;
  pullStatus: string;
  completed: boolean;
  rowsStored: number;
  rowsReturned: number;
  previousCompleteRowCount: number | null;
  inReportPlayerIds: Iterable<string>;
  notInReportPlayerIds?: Iterable<string>;
}): {
  pullRunId: number;
  membership: InjuryMembershipRow[];
  completenessReason: string;
  complete: boolean;
  healthClass: InjuryPullHealthClass;
  metadata: Record<string, unknown>;
} {
  const completeness = evaluateInjuryPullCompleteness({
    status: args.pullStatus,
    completed: args.completed,
    rowsStored: args.rowsStored,
    rowsReturned: args.rowsReturned,
    previousRowsStored: args.previousCompleteRowCount,
  });
  const healthClass = injuryPullHealthClass({
    status: args.pullStatus,
    complete: completeness.complete,
  });
  const membership = planInjuryPullMembership({
    pullRunId: args.pullRunId,
    observedAt: args.observedAt,
    inReportPlayerIds: args.inReportPlayerIds,
    notInReportPlayerIds: completeness.complete ? args.notInReportPlayerIds : [],
  });
  return {
    pullRunId: args.pullRunId,
    membership,
    completenessReason: completeness.reason,
    complete: completeness.complete,
    healthClass,
    metadata: {
      completeness_reason: completeness.reason,
      health_class: healthClass,
      membership_count: membership.length,
      collector_spec: 'context-collection-asof-r1',
    },
  };
}

export const UPSERT_INJURY_PULL_METADATA_SQL = `
  UPDATE raw.injury_pull_runs
     SET metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
   WHERE pull_run_id = $1
`;

export const OPTIONAL_INJURY_PULL_HEALTH_SQL = `
  UPDATE raw.injury_pull_runs
     SET completeness_reason = $2,
         health_class = $3
   WHERE pull_run_id = $1
`;

export const OPTIONAL_INJURY_MEMBERSHIP_SQL = `
  INSERT INTO raw.injury_pull_membership (
    pull_run_id, provider_player_id, analytics_player_id, in_report, observed_at
  ) VALUES ($1, $2, NULL, $3, $4)
  ON CONFLICT (pull_run_id, provider_player_id) DO NOTHING
`;

export function isMissingRelationError(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === '42P01' || e?.code === '42703';
}

export type PersistInjuryCollectorResult = {
  membershipPersisted: boolean;
  healthColumnsPersisted: boolean;
  schemaEnrichment: 'available' | 'unavailable';
  schemaMode: CollectionSchemaMode;
  missing: string[];
};

/**
 * Persist membership/health using capability checks. Optional mode records
 * schema_enrichment=unavailable instead of swallowing 42P01/42703 on the
 * live transaction. Required mode fails preflight before writes.
 */
export async function persistInjuryCollectorExtras(
  client: SqlQueryable,
  extras: ReturnType<typeof planInjuryCollectorExtras>,
  opts: {
    schemaMode?: CollectionSchemaMode;
    env?: Record<string, string | undefined>;
  } = {}
): Promise<PersistInjuryCollectorResult> {
  const schemaMode = opts.schemaMode ?? readCollectionSchemaMode(opts.env ?? process.env);
  const cap = await inspectInjuryCollectionSchema(client);
  assertSchemaReady({ mode: schemaMode, ready: cap.ready, missing: cap.missing });
  const schemaEnrichment: 'available' | 'unavailable' = cap.ready ? 'available' : 'unavailable';
  const metadata = {
    ...extras.metadata,
    schema_mode: schemaMode,
    schema_enrichment: schemaEnrichment,
    schema_missing: cap.missing,
  };

  await client.query('BEGIN');
  try {
    const pullRunId = extras.pullRunId;
    await client.query(UPSERT_INJURY_PULL_METADATA_SQL, [pullRunId, JSON.stringify(metadata)]);
    let healthColumnsPersisted = false;
    if (cap.completenessReasonColumn && cap.healthClassColumn) {
      const saved = await withSavepoint(client, 'injury_health', async () => {
        await client.query(OPTIONAL_INJURY_PULL_HEALTH_SQL, [
          pullRunId,
          extras.completenessReason,
          extras.healthClass,
        ]);
        return true;
      });
      healthColumnsPersisted = saved.ok;
      if (!saved.ok && schemaMode === 'required') throw saved.error;
    }
    let membershipPersisted = false;
    if (cap.membershipTable) {
      const saved = await withSavepoint(client, 'injury_membership', async () => {
        for (const row of extras.membership) {
          await client.query(OPTIONAL_INJURY_MEMBERSHIP_SQL, [
            row.pullRunId,
            row.playerId,
            row.inReport,
            row.observedAt,
          ]);
        }
        return true;
      });
      membershipPersisted = saved.ok;
      if (!saved.ok && schemaMode === 'required') throw saved.error;
    }
    await client.query('COMMIT');
    return {
      membershipPersisted,
      healthColumnsPersisted,
      schemaEnrichment,
      schemaMode,
      missing: cap.missing,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
