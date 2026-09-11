/**
 * Compact ingestion health JSON. Read-only. No BDL HTTP. No job invocation.
 *
 *   npx tsx scripts/ops/ingestion-health-report.ts
 */

import 'dotenv/config';
import { collectPlatformHealth } from '@/lib/ops/platform-health';
import { CLOUDWATCH_QUERIES } from '@/lib/ops/cloudwatch-queries';
import { freshnessToReadiness } from '@/lib/ops/ingestion-observability';

async function main() {
  const report = await collectPlatformHealth({ s3: null });
  const readiness = Object.fromEntries(
    report.families.map((family) => [
      family.id,
      {
        config: family.config,
        freshness: family.freshness,
        grade: freshnessToReadiness(family.freshness, family.status),
        reason: family.reason,
      },
    ])
  );
  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        overall: report.overall,
        freeze: report.freeze,
        identity: {
          status: report.identity.status,
          unresolved: report.identity.unresolved,
          conflicts: report.identity.conflicts,
          resolved: report.identity.resolved,
          classCCanonical: report.identity.classCCanonical,
          alert: report.identity.alert,
          reason: report.identity.reason,
        },
        scheduleCompleteness: report.scheduleCompleteness,
        scheduleMismatch: report.scheduleMismatch,
        queues: report.queues,
        queueCards: report.queueCards,
        providers: report.providers.map((row) => ({
          id: row.id,
          state: row.state,
          status: row.status,
        })),
        aws: report.aws,
        readiness,
        cloudwatchQueries: CLOUDWATCH_QUERIES,
        printsSecrets: false,
        invokedJobs: false,
        bdlHttp: 0,
      },
      null,
      2
    )
  );
}

void main();
