/**
 * Shared ingestion run accounting. Helpers only — workers are not rewritten in 13G.1.
 */

import type { IngestIdentityAccounting } from '@/lib/identity/ingest-identity-gate';

export type IngestionRunStatus = 'success' | 'partial' | 'failed' | 'skipped';

export type IngestionRunResult = {
  event: 'ingestion_run';
  job: string;
  runId?: string | number;
  status: IngestionRunStatus;
  inputCount: number;
  outputCount: number;
  skippedCount: number;
  quarantinedCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  reason?: string;
  providerStatus?: number | null;
  identity?: Pick<
    IngestIdentityAccounting,
    'serving' | 'notServingYet' | 'unresolved' | 'conflicts' | 'quarantined'
  >;
};

export function buildIngestionRunResult(
  input: Omit<IngestionRunResult, 'event' | 'durationMs'> & { durationMs?: number }
): IngestionRunResult {
  const started = Date.parse(input.startedAt);
  const finished = Date.parse(input.finishedAt);
  const durationMs =
    input.durationMs ??
    (Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0);
  return { event: 'ingestion_run', ...input, durationMs };
}

export function ingestionRunIsPartial(input: {
  status: IngestionRunStatus;
  skippedCount: number;
  quarantinedCount: number;
}): boolean {
  if (input.status === 'failed' || input.status === 'skipped') return false;
  return input.skippedCount > 0 || input.quarantinedCount > 0 || input.status === 'partial';
}
