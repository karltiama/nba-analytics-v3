/**
 * Concise shadow health summary for platform-health. No notifications are sent.
 */

import type { HealthStatus } from '@/lib/ops/health-status';
import { classifyFeedFreshness, type FeedConfigState } from '@/lib/ops/ingestion-observability';
import type { SqlQueryable } from '@/lib/db/schema-capability';
import { inspectShadowWriteSchema } from '@/lib/db/schema-capability';
import { classifyShadowDueWindow } from '@/lib/betting/player-projection-shadow-scoring';
import {
  countSettlementBacklog,
  latestFinalLogAt,
  loadCurrentWindowAnchor,
  loadShadowHealthRows,
  loadUpcomingGames,
} from '@/lib/betting/player-projection-shadow-store';

export type ShadowHealthSummary = {
  status: HealthStatus;
  reason: string;
  schemaEnrichment: 'available' | 'unavailable';
  lastSuccessfulCollectionAt: string | null;
  lastSuccessfulCollectionAgeHours: number | null;
  failedOrIncompletePulls: number;
  unresolvedIdentities: number;
  due: number;
  onTime: number;
  late: number;
  failed: number;
  missing: number;
  staleFeatureInputs: boolean;
  featureInputAgeHours: number | null;
  settlementBacklog: number | null;
  windowStart: string | null;
  alertsPrepared: boolean;
  notificationDestination: string | null;
};

export async function summarizeShadowHealth(args: {
  db: SqlQueryable;
  now: Date;
  config: FeedConfigState;
  env?: Record<string, string | undefined>;
}): Promise<ShadowHealthSummary> {
  const env = args.env ?? process.env;
  const destination = env.OPS_ALERT_SNS_TOPIC_ARN || env.SNS_ALERT_TOPIC_ARN || null;
  const schema = await inspectShadowWriteSchema(args.db);
  const schemaEnrichment = schema.ready ? 'available' : 'unavailable';
  if (!schema.ready) {
    const requireSchema =
      env.COLLECTION_SCHEMA_MODE === 'required' || env.SHADOW_SNAPSHOT_WRITES === '1';
    const frozen = args.config === 'FROZEN' || args.config === 'NOT_DEPLOYED';
    return {
      status: requireSchema ? 'FAILED' : frozen ? 'FROZEN_EXPECTED' : 'UNKNOWN',
      reason: requireSchema
        ? `required shadow schema missing: ${schema.missing.join(', ')}`
        : `schema enrichment unavailable (${schema.missing.join(', ')}); collection writes not required`,
      schemaEnrichment,
      lastSuccessfulCollectionAt: null,
      lastSuccessfulCollectionAgeHours: null,
      failedOrIncompletePulls: 0,
      unresolvedIdentities: 0,
      due: 0,
      onTime: 0,
      late: 0,
      failed: 0,
      missing: 0,
      staleFeatureInputs: false,
      featureInputAgeHours: null,
      settlementBacklog: null,
      windowStart: null,
      alertsPrepared: Boolean(destination),
      notificationDestination: destination,
    };
  }

  const rows = await loadShadowHealthRows(args.db);
  const lastBox = await latestFinalLogAt(args.db);
  const featureInputAgeHours =
    lastBox == null ? null : (args.now.getTime() - Date.parse(lastBox)) / 3_600_000;
  const staleFeatureInputs = featureInputAgeHours != null && featureInputAgeHours > 36;
  const lastRun = rows.lastRun ?? {};
  const freshness = classifyFeedFreshness({
    config: args.config,
    lastSuccessAt: rows.lastSuccessAt ? new Date(rows.lastSuccessAt) : null,
    now: args.now,
    slaHours: 6,
  });
  const games = await loadUpcomingGames(args.db);
  const nowIso = args.now.toISOString();
  const due = games.filter((g) => classifyShadowDueWindow({ scheduledTipoff: g.scheduledTipoff, now: nowIso }) === 'due').length;
  const window = await loadCurrentWindowAnchor(args.db);
  let status: HealthStatus = freshness.health;
  if (staleFeatureInputs && args.config === 'ACTIVE') status = 'STALE';
  const summary: ShadowHealthSummary = {
    status,
    reason: freshness.reason,
    schemaEnrichment,
    lastSuccessfulCollectionAt: rows.lastSuccessAt,
    lastSuccessfulCollectionAgeHours: rows.lastSuccessAt
      ? (args.now.getTime() - Date.parse(rows.lastSuccessAt)) / 3_600_000
      : null,
    failedOrIncompletePulls: rows.lastFailedAt ? 1 : 0,
    unresolvedIdentities: Number(lastRun.ineligible_count ?? 0),
    due,
    onTime: Number(lastRun.on_time_count ?? 0),
    late: Number(lastRun.late_count ?? 0),
    failed: Number(lastRun.failed_count ?? 0),
    missing: Number(lastRun.missing_count ?? 0),
    staleFeatureInputs,
    featureInputAgeHours,
    settlementBacklog: schema.predictionSettlements ? await countSettlementBacklog(args.db) : null,
    windowStart: window?.firstRegularSeasonTipoff ?? null,
    alertsPrepared: Boolean(destination),
    notificationDestination: destination,
  };
  return summary;
}
