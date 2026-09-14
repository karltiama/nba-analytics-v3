/**
 * Player-props DLQ operator tool. Default is inspect-only.
 * Does NOT redrive unless --execute is passed.
 *
 * SQS payload is {runId, gameId, bdlGameId, date} — not the original BDL JSON.
 * Prefer repair-prop-archive-from-postgres.ts when Postgres already has the board.
 *
 *   npx tsx scripts/ops/redrive-player-props-dlq.ts
 *   npx tsx scripts/ops/redrive-player-props-dlq.ts --execute
 *
 * Console equivalent:
 *   SQS → nba-player-props-game-dlq → Start DLQ redrive to nba-player-props-game-queue
 */
import 'dotenv/config';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
} from '@aws-sdk/client-sqs';

const SOURCE_NAME = process.env.OPS_PROPS_DLQ ?? 'nba-player-props-game-dlq';
const DEST_NAME = process.env.OPS_PROPS_QUEUE ?? 'nba-player-props-game-queue';

function isExecute(argv: string[]): boolean {
  return argv.includes('--execute');
}

async function main() {
  const execute = isExecute(process.argv);
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const client = new SQSClient({ region });
  const sourceUrl = (
    await client.send(new GetQueueUrlCommand({ QueueName: SOURCE_NAME }))
  ).QueueUrl;
  const destUrl = (
    await client.send(new GetQueueUrlCommand({ QueueName: DEST_NAME }))
  ).QueueUrl;
  if (!sourceUrl || !destUrl) throw new Error('Could not resolve queue URLs');

  const attrs = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: sourceUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'MessageRetentionPeriod',
      ],
    })
  );
  const destAttrs = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: destUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'RedrivePolicy'],
    })
  );

  const report = {
    execute,
    sourceName: SOURCE_NAME,
    destName: DEST_NAME,
    sourceUrl,
    destUrl,
    dlqVisible: Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0),
    dlqInFlight: Number(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
    dlqRetentionSeconds: Number(attrs.Attributes?.MessageRetentionPeriod ?? 0),
    destVisible: Number(destAttrs.Attributes?.ApproximateNumberOfMessages ?? 0),
    payloadNote:
      'DLQ body is the original SQS worker pointer (runId/gameId/bdlGameId/date), not the BDL board. Redrive re-fetches BDL. If lines moved, S3 checksum may conflict. Repair from Postgres instead when rows_stored > 0.',
    operatorSteps: [
      '1. Confirm ArchiveFailed/ArchiveGap alarms and reconcile:prop-archive --s3.',
      '2. If Postgres already has the snapshot, run repair-prop-archive-from-postgres.ts --pull-run-id --game-id (dry-run first).',
      '3. Only redrive SQS when the worker never wrote rows (fetch/normalize failure) or after archive repair is not possible.',
      '4. Worker freeze must be OFF or the redrive will drain without writes.',
      '5. ESM must be Enabled or the destination queue will not invoke the worker.',
      '6. Re-run this command with --execute only after those checks.',
    ],
  };
  console.log(JSON.stringify(report, null, 2));

  if (!execute) {
    console.log('Dry-run only. No StartMessageMoveTask.');
    return;
  }
  if (report.dlqVisible + report.dlqInFlight === 0) {
    console.log('DLQ empty; nothing to redrive.');
    return;
  }
  const task = await client.send(
    new StartMessageMoveTaskCommand({
      SourceArn: sourceUrl.replace(
        /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d+)\/(.+)$/,
        'arn:aws:sqs:$1:$2:$3'
      ),
      DestinationArn: destUrl.replace(
        /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d+)\/(.+)$/,
        'arn:aws:sqs:$1:$2:$3'
      ),
    })
  );
  console.log(JSON.stringify({ started: true, taskHandle: task.TaskHandle }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
