/**
 * Safe local simulation of the player-prop archive pipeline.
 * Uses an in-memory store. Does not write to NBA_DATA_BUCKET.
 *
 *   npm run simulate:prop-archive
 */

import { simulatePlayerPropArchivePipeline } from '@/lib/archive/simulate-player-prop-archive';

async function main(): Promise<void> {
  const demo = await simulatePlayerPropArchivePipeline();
  console.log(
    JSON.stringify(
      {
        ok: true,
        wroteCanonicalHistoricalPrefix: false,
        ...demo,
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
