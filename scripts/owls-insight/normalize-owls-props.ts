/**
 * Normalize Owls archives offline. Does not call Owls.
 *
 *   npm run normalize:owls-props -- --run-id owls-2026-09-14-probe
 */
import 'dotenv/config';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import { parseOwlsCliArgs } from '@/lib/providers/owls-insight/cli';
import { normalizeOwlsArchiveOffline } from '@/lib/providers/owls-insight/backfill';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { OWLS_ENTITY_PLAYER_PROPS, OWLS_SOURCE_PREFIX } from '@/lib/providers/owls-insight/contract';

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  if (args.execute) throw new Error('normalize:owls-props never calls Owls. Remove --execute.');
  if (!args.runId) throw new Error('Missing --run-id');
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET is required to read the archive.');
  const store = new OwlsS3Store(bucket);
  const raw = (process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  const seasons = args.season ? [args.season] : ['2023', '2024', '2025'];
  let rows = 0;
  const keys: string[] = [];
  for (const season of seasons) {
    const prefix = `${raw}/source=${OWLS_SOURCE_PREFIX}/league=nba/season=${season}/entity=${OWLS_ENTITY_PLAYER_PROPS}/`;
    const out = await normalizeOwlsArchiveOffline({ store, prefix });
    rows += out.rows;
    keys.push(...out.keys);
  }
  const checkpoints = new FileCheckpointStore('data/owls-insight/runs');
  const state = await checkpoints.load(args.runId);
  console.log(
    JSON.stringify(
      {
        runId: args.runId,
        networkCalls: 0,
        objectsRead: keys.length,
        normalizedRows: rows,
        checkpointPresent: Boolean(state),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
