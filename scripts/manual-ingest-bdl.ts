/**
 * Manual Ingest Props from BDL
 * 
 * Fetches and stores today's player props directly into analytics.player_props_current.
 * This script is used to bypass the SQS fan-out for local manual runs.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { 
  getGameTargetsForDate, 
  getTodayET 
} from '../lambda/player-props-snapshot/src/game-discovery';
import { fetchPlayerPropsForGame } from '../lambda/player-props-snapshot/src/fetch';
import { normalizePlayerPropRows } from '../lambda/player-props-snapshot/src/normalize';
import { 
  bulkUpsertCurrent, 
  createPullRun, 
  completePullRun, 
  buildPreferredVendorLines, 
  refreshPreferredVendorCurrent 
} from '../lambda/player-props-snapshot/src/bulk-writers';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BALLDONTLIE_API_KEY = process.env.BALDONTLIE_API_KEY || process.env.BALLDONTLIE_API_KEY;

if (!SUPABASE_DB_URL || !BALLDONTLIE_API_KEY) {
  console.error('Missing environment variables. Check .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  const date = getTodayET();
  console.log(`🚀 Manual Props Sync for ${date}`);

  const targets = await getGameTargetsForDate(pool as any, date);
  console.log(`📡 Found ${targets.length} games to target.`);

  const pullRunId = await createPullRun(pool as any, targets.map((g) => g.gameId));
  const snapshotAt = new Date();

  for (const t of targets) {
    console.log(`\n🎮 Game: ${t.gameId} (BDL ID: ${t.bdlGameId})`);
    try {
      const props = await fetchPlayerPropsForGame(BALLDONTLIE_API_KEY as string, t.bdlGameId);
      console.log(`   ✅ Fetched ${props.length} props.`);

      if (props.length > 0) {
        const normalized = normalizePlayerPropRows(props);
        
        // 1. Update modern analytics.player_props_current (used by current UI)
        const currentCount = await bulkUpsertCurrent(pool as any, normalized, snapshotAt);
        console.log(`   💾 Upserted ${currentCount} rows into analytics.player_props_current.`);

        // 2. Update legacy analytics.player_prop_current (if still in use by some parts of the app)
        const preferred = buildPreferredVendorLines(normalized, 'draftkings', snapshotAt);
        const legacyCount = await refreshPreferredVendorCurrent(pool as any, pullRunId, t.gameId, preferred);
        console.log(`   💾 Upserted ${legacyCount} rows into legacy analytics.player_prop_current.`);
      }
    } catch (error: any) {
      console.error(`   ❌ Failed for game ${t.gameId}:`, error);
    }
  }

  await completePullRun(pool as any, pullRunId, 'success', 0, 0);
  console.log('\n✅ Sync complete!');
  await pool.end();
}

main().catch(console.error);
