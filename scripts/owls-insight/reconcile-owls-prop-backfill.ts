/**
 * Reconcile an Owls backfill run's checkpoint against archived objects.
 * Does not call Owls.
 */
import 'dotenv/config';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import { parseOwlsCliArgs } from '@/lib/providers/owls-insight/cli';
import { InMemoryOwlsStore } from '@/lib/providers/owls-insight/archive';
import { reconcileOwlsPropBackfill } from '@/lib/providers/owls-insight/reconcile';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  if (!args.runId) throw new Error('Missing --run-id');
  if (args.execute) throw new Error('reconcile:owls-prop-backfill never calls Owls. Remove --execute.');
  const checkpoints = new FileCheckpointStore('data/owls-insight/runs');
  const state = await checkpoints.load(args.runId);
  const store = args.fixture
    ? new InMemoryOwlsStore()
    : new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const report = await reconcileOwlsPropBackfill({ runId: args.runId, state, store });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
