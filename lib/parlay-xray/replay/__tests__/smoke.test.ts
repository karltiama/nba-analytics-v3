import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { HISTORICAL_REPLAY_COVERAGE_SQL, HISTORICAL_REPLAY_LOOKUP_SQL } from '../sql';
import { loadHistoricalMovementRows } from '../load';
import { matchHistoricalParlayLeg } from '../match';
import type { HistoricalParlayLegReplayInput } from '../types';

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

describe.skipIf(!url)('historical replay product DB smoke (read-only)', () => {
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

  it('finds stored 3-hour/close rows without reading outcomes', async () => {
    const query = async <T,>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    };

    expect(HISTORICAL_REPLAY_LOOKUP_SQL.toLowerCase()).not.toContain('player_game_logs');
    const coverage = await query<{
      row_count: number;
      game_count: number;
      vendor_count: number;
      market_count: number;
      reference_line_count: number;
      comparison_line_count: number;
    }>(HISTORICAL_REPLAY_COVERAGE_SQL);
    const stats = coverage[0];
    expect(stats?.row_count).toBeGreaterThan(0);
    expect(stats?.game_count).toBeGreaterThan(0);
    expect(stats?.vendor_count).toBeGreaterThan(0);
    expect(stats?.reference_line_count).toBeGreaterThan(0);
    expect(stats?.comparison_line_count).toBeGreaterThan(0);

    const sample = await query<{
      game_id: string;
      player_id: string;
      prop_type: string;
      vendor: string;
      reference_line: string | number | null;
    }>(
      `SELECT game_id, player_id, prop_type, vendor, reference_line
       FROM analytics.player_prop_market_movement
       WHERE reference_line IS NOT NULL
       ORDER BY game_id, player_id, prop_type, vendor
       LIMIT 1`
    );
    const row = sample[0];
    expect(row).toBeTruthy();
    const rows = await loadHistoricalMovementRows(query, {
      gameId: row!.game_id,
      playerId: row!.player_id,
      propType: row!.prop_type,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.game_id === row!.game_id && r.player_id === row!.player_id)).toBe(true);

    const input: HistoricalParlayLegReplayInput = {
      historicalDate: '2026-04-10',
      playerId: row!.player_id,
      playerDisplayName: null,
      entityId: null,
      gameId: row!.game_id,
      market: row!.prop_type as HistoricalParlayLegReplayInput['market'],
      marketUnsupported: false,
      side: 'over',
      line: Number(row!.reference_line),
      sportsbookVendor: row!.vendor,
      playerResolved: true,
      gameResolved: true,
    };
    const match = matchHistoricalParlayLeg(input, rows);
    expect(match.status).toBe('MATCHED');
    expect(match.exactness.bookExact).toBe(true);
    expect(match.lineQuality).toBe('EXACT_LINE_MATCH');
    expect(match.reference.kind).toBe('3_hour_pre_tip');
    expect(match.comparison.kind).toBe('decision_close');
  });
});
