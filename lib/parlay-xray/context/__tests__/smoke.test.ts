import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { assembleXrayLegContext } from '../assemble';
import { loadTargetGame, loadXrayContextSources, matchupTeamIds, teamIdsFromResolution } from '../load';
import { matchHistoricalParlayLeg } from '@/lib/parlay-xray/replay/match';
import { loadHistoricalMovementRows } from '@/lib/parlay-xray/replay/load';
import { resolution } from './fixtures';

function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    let text = '';
    try {
      text = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

loadEnv();

const url = (process.env.SUPABASE_DB_URL ?? '').trim();
const GAME_ID = '18447934';

describe.skipIf(!url)('X3C historical context product DB smoke (read-only)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('assembles an Ajay Mitchell points packet without outcomes', async () => {
    const query = async <T,>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    };

    const target = await loadTargetGame(query, GAME_ID);
    expect(target).toBeTruthy();
    const cutoff = target!.startTime;
    const players = await query<{ player_id: string; full_name: string }>(
      `SELECT p.player_id::text AS player_id, p.full_name
         FROM analytics.players p
        WHERE p.full_name ILIKE 'Ajay Mitchell'
        LIMIT 1`
    );
    const playerId = players[0]?.player_id;
    expect(playerId).toBeTruthy();

    const resolved = resolution({ playerId, gameId: GAME_ID, line: 11.5, market: 'points' });
    const rows = await loadHistoricalMovementRows(query, {
      gameId: GAME_ID,
      playerId: playerId!,
      propType: 'points',
    });
    const match = matchHistoricalParlayLeg(
      {
        historicalDate: cutoff.slice(0, 10),
        playerId: playerId!,
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
      playerId: playerId!,
      gameId: GAME_ID,
      cutoffAt: cutoff,
      season: target!.season,
      teamIds: teamIdsFromResolution(resolved, target),
    });
    expect(sources.priorPlayerLogs.every((log) => log.gameId !== GAME_ID)).toBe(true);
    expect(sources.priorPlayerLogs.every((log) => Date.parse(log.startTime) < Date.parse(cutoff))).toBe(true);

    const packet = assembleXrayLegContext({
      resolution: resolved,
      match,
      contextCutoffAt: cutoff,
      season: target!.season,
      playerTeamId: mapped.playerTeamId,
      opponentTeamId: mapped.opponentTeamId,
      sources,
    });
    expect(packet.identity.playerDisplayName).toBe('Ajay Mitchell');
    expect(packet.identity.gameId).toBe(GAME_ID);
    expect(packet.identity.contextCutoffAt).toBe(cutoff);
    expect(packet.wowy.status).toBe('UNAVAILABLE');
    expect(packet.availability.status).toBe('UNAVAILABLE');
    expect(packet.playerForm.seasonToDate.average).not.toBeNull();
    expect(JSON.stringify(packet)).not.toMatch(/home_score|away_score|bet_result|final_points/);
  });
});
