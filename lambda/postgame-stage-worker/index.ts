/**
 * CODE_ONLY postgame SQS adapter (13F.3).
 *
 * Real stage dispatch lives in lib/postgame/worker.ts and is fixture-tested there.
 * This Lambda zip does not bundle @/lib. Accidental invoke must fail closed:
 * freeze → ack/skip; thawed but unbundled → report batch failures (DLQ), never BDL/S3/DB.
 *
 * Do not deploy. Event source mapping is disabled while live_ingestion_enabled=false.
 */

type SqsRecord = { messageId: string; body: string };
type SqsEvent = { Records?: SqsRecord[] };

function frozen(env: NodeJS.ProcessEnv = process.env): boolean {
  const dataMode = (env.DATA_MODE ?? '').trim().toLowerCase();
  const liveIngestion =
    (env.LIVE_INGESTION_ENABLED ?? '').trim().toLowerCase() === '1' ||
    (env.LIVE_INGESTION_ENABLED ?? '').trim().toLowerCase() === 'true';
  const skipMutations =
    env.CRON_DRY_RUN === '1' || env.OFFSEASON_MODE === '1' || dataMode !== 'live_api';
  return !liveIngestion || skipMutations;
}

export async function handler(event: SqsEvent): Promise<{
  batchItemFailures: { itemIdentifier: string }[];
  skipped: boolean;
  reason: string;
}> {
  const records = event.Records ?? [];
  if (frozen()) {
    console.log(
      JSON.stringify({
        event: 'postgame_stage_skipped',
        reason_code: null,
        frozen: true,
        drained: records.length,
      })
    );
    return {
      batchItemFailures: [],
      skipped: true,
      reason: 'postgame worker frozen; no provider or serving writes',
    };
  }
  console.log(
    JSON.stringify({
      event: 'postgame_stage_failed',
      reason_code: 'QUALITY_FAILED',
      detail: 'postgame-stage-worker is CODE_ONLY and not bundled for live dispatch',
    })
  );
  return {
    batchItemFailures: records.map((row) => ({ itemIdentifier: row.messageId })),
    skipped: false,
    reason: 'CODE_ONLY_NOT_BUNDLED',
  };
}
