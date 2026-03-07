/**
 * Compute analytics.player_season_averages from analytics.player_game_logs.
 * Idempotent (upserts). Run after transform-raw-to-analytics.ts.
 *
 * Env: SUPABASE_DB_URL
 *
 * Usage: npx tsx scripts/compute-player-season-averages.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const upsertSeasonAvg = `
  insert into analytics.player_season_averages (
    player_id, season, games_played,
    pts_avg, reb_avg, ast_avg, stl_avg, blk_avg, turnover_avg, pra_avg,
    fg_pct, fg3_pct, ft_pct
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  on conflict (player_id, season) do update set
    games_played = excluded.games_played,
    pts_avg = excluded.pts_avg,
    reb_avg = excluded.reb_avg,
    ast_avg = excluded.ast_avg,
    stl_avg = excluded.stl_avg,
    blk_avg = excluded.blk_avg,
    turnover_avg = excluded.turnover_avg,
    pra_avg = excluded.pra_avg,
    fg_pct = excluded.fg_pct,
    fg3_pct = excluded.fg3_pct,
    ft_pct = excluded.ft_pct,
    updated_at = now();
`;

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      select
        player_id,
        season,
        count(*)::int as games_played,
        avg(points) as pts_avg,
        avg(rebounds) as reb_avg,
        avg(assists) as ast_avg,
        avg(steals) as stl_avg,
        avg(blocks) as blk_avg,
        avg(turnovers) as turnover_avg,
        avg(pra) as pra_avg,
        case when sum(field_goals_attempted) > 0 then sum(field_goals_made)::numeric / sum(field_goals_attempted) else null end as fg_pct,
        case when sum(three_pointers_attempted) > 0 then sum(three_pointers_made)::numeric / sum(three_pointers_attempted) else null end as fg3_pct,
        case when sum(free_throws_attempted) > 0 then sum(free_throws_made)::numeric / sum(free_throws_attempted) else null end as ft_pct
      from analytics.player_game_logs
      where season is not null and season <> ''
      group by player_id, season
    `);
    console.log(`Upserting ${res.rows.length} player season averages...`);
    await client.query('begin');
    for (const r of res.rows) {
      await client.query(upsertSeasonAvg, [
        r.player_id,
        r.season,
        r.games_played ?? 0,
        r.pts_avg ?? null,
        r.reb_avg ?? null,
        r.ast_avg ?? null,
        r.stl_avg ?? null,
        r.blk_avg ?? null,
        r.turnover_avg ?? null,
        r.pra_avg ?? null,
        r.fg_pct ?? null,
        r.fg3_pct ?? null,
        r.ft_pct ?? null,
      ]);
    }
    await client.query('commit');
    console.log('Done.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
