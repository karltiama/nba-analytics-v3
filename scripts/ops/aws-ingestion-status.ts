/**
 * Read-only Court Context ingestion AWS status.
 *
 *   npx tsx scripts/ops/aws-ingestion-status.ts
 *
 * No Lambda invoke, no SQS send/purge, no schedule mutation, no provider HTTP.
 */

import 'dotenv/config';
import { fetchAwsIngestionSnapshot } from '@/lib/ops/aws-ingestion-status';

function assertNoSecrets(payload: string): void {
  if (/AWS_SECRET|BALLDONTLIE|password=|AKIA[0-9A-Z]{16}/i.test(payload)) {
    throw new Error('Refusing to print a payload that looks like it contains secrets');
  }
}

async function main() {
  const snapshot = await fetchAwsIngestionSnapshot({ force: true, timeoutMs: 12_000 });
  const body = {
    queried: snapshot.queried,
    available: snapshot.available,
    reason: snapshot.reason,
    scheduleObserved: snapshot.scheduleObserved,
    lambdas: snapshot.lambdas.map((row) => ({
      id: row.id,
      exists: row.exists,
      deployState: row.deployState,
      state: row.state,
      scheduleObserved: row.scheduleObserved,
      lastInvocationAt: row.lastInvocationAt,
      lastInvocationSuccess: row.lastInvocationSuccess,
      errors24h: row.errors24h,
      throttles24h: row.throttles24h,
      reservedConcurrencyApplied: row.reservedConcurrencyApplied,
    })),
    queues: snapshot.queues.map((row) => ({
      id: row.id,
      deployState: row.deployState,
      visible: row.visible,
      inFlight: row.notVisible,
      oldestAgeSeconds: row.oldestAgeSeconds,
      dlqDepth: row.dlqDepth,
    })),
    printsSecrets: false,
    invokedJobs: false,
    bdlHttp: 0,
    mutated: false,
  };
  const json = JSON.stringify(body, null, 2);
  assertNoSecrets(json);
  console.log(json);
}

void main();
