/**
 * Read-only dump of one historical XRay context packet.
 * Does not enable extraction. Does not write.
 *
 *   npx tsx scripts/ops/run-parlay-xray-x3c-example.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { assembleXrayLegContext } from '@/lib/parlay-xray/context/assemble';
import { loadTargetGame, loadXrayContextSources, matchupTeamIds, teamIdsFromResolution } from '@/lib/parlay-xray/context/load';
import { loadHistoricalMovementRows } from '@/lib/parlay-xray/replay/load';
import { matchHistoricalParlayLeg } from '@/lib/parlay-xray/replay/match';
import { resolution } from '@/lib/parlay-xray/context/__tests__/fixtures';

const GAME_ID = process.argv[2] || '18447934';

async function main() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  const query = async <T,>(sql: string, params?: unknown[]) => {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  };
  try {
    const target = await loadTargetGame(query, GAME_ID);
    if (!target) throw new Error(`game ${GAME_ID} not found`);
    const players = await query<{ player_id: string; full_name: string }>(
      `SELECT p.player_id::text AS player_id, p.full_name
         FROM analytics.players p
        WHERE p.full_name ILIKE 'Ajay Mitchell'
        LIMIT 1`
    );
    const playerId = players[0]?.player_id;
    if (!playerId) throw new Error('Ajay Mitchell not found');
    const resolved = resolution({ playerId, gameId: GAME_ID, line: 11.5, market: 'points' });
    const rows = await loadHistoricalMovementRows(query, {
      gameId: GAME_ID,
      playerId,
      propType: 'points',
    });
    const match = matchHistoricalParlayLeg(
      {
        historicalDate: target.startTime.slice(0, 10),
        playerId,
        playerDisplayName: 'Ajay Mitchell',
        entityId: null,
        gameId: GAME_ID,
        market: 'points',
        marketUnsupported: false,
        side: 'over',
        line: 11.5,
        sportsbookVendor: 'draftkings',
        playerResolved: true,
        gameResolved: true,
      },
      rows
    );
    const mapped = matchupTeamIds(resolved, target);
    const sources = await loadXrayContextSources(query, {
      playerId,
      gameId: GAME_ID,
      cutoffAt: target.startTime,
      season: target.season,
      teamIds: teamIdsFromResolution(resolved, target),
    });
    const packet = assembleXrayLegContext({
      resolution: resolved,
      match,
      contextCutoffAt: target.startTime,
      season: target.season,
      playerTeamId: mapped.playerTeamId,
      opponentTeamId: mapped.opponentTeamId,
      sources,
    });
    const preview = {
      identity: {
        playerDisplayName: packet.identity.playerDisplayName,
        playerId: packet.identity.playerId,
        gameId: packet.identity.gameId,
        teamAbbr: packet.identity.teamAbbr,
        opponentAbbr: packet.identity.opponentAbbr,
        market: packet.identity.market,
        side: packet.identity.side,
        line: packet.identity.line,
        sportsbook: packet.identity.sportsbook,
        contextCutoffAt: packet.identity.contextCutoffAt,
        historicalDate: packet.identity.historicalDate,
      },
      market: packet.market,
      playerForm: packet.playerForm,
      role: {
        status: packet.role.status,
        reason: packet.role.reason,
        priorGameMinutes: packet.role.priorGameMinutes,
        seasonToDateMinutes: packet.role.seasonToDateMinutes,
        last5Minutes: packet.role.last5Minutes,
        last10Minutes: packet.role.last10Minutes,
        gamesPlayed: packet.role.gamesPlayed,
        startersPregame: packet.role.startersPregame,
      },
      matchup: packet.matchup,
      wowy: packet.wowy,
      projection: packet.projection,
      availability: packet.availability,
      dataQuality: packet.dataQuality,
    };
    console.log(JSON.stringify(preview, null, 2));
  } finally {
    await pool.end();
  }
}

void main();
