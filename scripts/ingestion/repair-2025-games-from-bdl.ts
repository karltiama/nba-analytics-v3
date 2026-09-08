/**
 * Games-only 2025 repair from cached BDL /games. No /stats.
 *
 *   npx tsx scripts/ingestion/repair-2025-games-from-bdl.ts --dry-run
 *   npx tsx scripts/ingestion/repair-2025-games-from-bdl.ts --execute   # refused unless scoped confirm
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import {
  DO_NOT_TOUCH_LOCAL_ONLY_ID,
  GAMES_ONLY_REPAIR_IDS,
} from '@/lib/ingestion/goat-stats-repair-queue';
import {
  assertGamesOnlyExecuteScope,
  planGamesOnlyRepair,
  UPSERT_GAMES_ONLY_SQL,
  type CachedBdlGame,
  type LocalGameSnapshot,
} from '@/lib/ingestion/repair-2025-games';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';

function loadCache(): CachedBdlGame[] {
  const p = path.join(process.cwd(), 'reports', 'trial', 'bdl-games-2025.json');
  const doc = JSON.parse(fs.readFileSync(p, 'utf8')) as { games: CachedBdlGame[] };
  return doc.games;
}

async function loadLocal(client: PoolClient): Promise<LocalGameSnapshot[]> {
  const ids = GAMES_ONLY_REPAIR_IDS.map(String);
  ids.push(String(DO_NOT_TOUCH_LOCAL_ONLY_ID));
  const res = await client.query<LocalGameSnapshot>(
    `select game_id, season, status, home_team_id, away_team_id, home_score, away_score, start_time::text as start_time
     from analytics.games where game_id = any($1::text[])`,
    [ids]
  );
  return res.rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute') && !argv.includes('--dry-run');
  const bdlGames = loadCache();
  let localGames: LocalGameSnapshot[] = [];
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    localGames = await loadLocal(client);
  } catch (e) {
    console.warn('[warn] DB unavailable for local snapshot; planning from cache + empty local set.');
    console.warn(e instanceof Error ? e.message : String(e));
  }

  const plan = planGamesOnlyRepair({ bdlGames, localGames });
  console.log(`Games-only repair mutations: ${plan.mutations.length}`);
  console.log(`statsCalls: ${plan.statsCalls}`);
  console.log(JSON.stringify(plan, null, 2));

  if (!execute) {
    console.log('\n[dry-run] no writes. Remaining GOAT /v1/stats queue is unchanged (34 IDs).');
    if (client) client.release();
    return;
  }

  const mode = readIngestionMode();
  const confirm = argv.includes('--i-understand-production-write');
  if (!mode.shouldSkipMutations && !confirm) {
    console.error('[fatal] Production is not frozen; refusing games-only execute without --i-understand-production-write');
    process.exit(1);
  }
  if (!confirm) {
    console.error('[fatal] Refusing --execute without --i-understand-production-write. Dry-run only unless explicitly confirmed.');
    process.exit(1);
  }
  assertGamesOnlyExecuteScope(plan.mutations);
  if (!client) {
    console.error('[fatal] No DB client for execute');
    process.exit(1);
  }
  try {
    await client.query('begin');
    for (const m of plan.mutations) {
      await client.query(UPSERT_GAMES_ONLY_SQL, [
        m.to.game_id,
        m.to.season,
        m.to.start_time,
        m.to.status,
        m.to.home_team_id,
        m.to.away_team_id,
        m.to.home_score,
        m.to.away_score,
        String(DO_NOT_TOUCH_LOCAL_ONLY_ID),
      ]);
    }
    await client.query('commit');
    console.log(`[wrote] ${plan.mutations.length} analytics.games rows (games-only, no /stats)`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
