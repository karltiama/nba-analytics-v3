/**
 * Transform raw.* → analytics.* with upserts.
 * Run after raw tables are seeded. Idempotent.
 *
 * Prerequisites: analytics_schema.sql and analytics_schema_migration.sql applied.
 * Env: SUPABASE_DB_URL
 *
 * Usage: npx tsx scripts/transform-raw-to-analytics.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const upsertTeam = `
  insert into analytics.teams (team_id, abbreviation, full_name, name, city, conference, division)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (team_id) do update set
    abbreviation = excluded.abbreviation,
    full_name = excluded.full_name,
    name = excluded.name,
    city = excluded.city,
    conference = excluded.conference,
    division = excluded.division,
    updated_at = now();
`;

const upsertPlayer = `
  insert into analytics.players (player_id, full_name, first_name, last_name, position, height, weight)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (player_id) do update set
    full_name = excluded.full_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    updated_at = now();
`;

const upsertGame = `
  insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score, venue)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  on conflict (game_id) do update set
    season = excluded.season,
    start_time = excluded.start_time,
    status = excluded.status,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    venue = excluded.venue,
    updated_at = now();
`;

const upsertPlayerGameLog = `
  insert into analytics.player_game_logs (
    game_id, player_id, team_id,
    minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
    assists, steals, blocks, turnovers, personal_fouls,
    field_goals_made, field_goals_attempted,
    three_pointers_made, three_pointers_attempted,
    free_throws_made, free_throws_attempted,
    plus_minus,
    opponent_team_id, is_home, game_date, season, pra
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
  on conflict (game_id, player_id) do update set
    team_id = excluded.team_id,
    minutes = excluded.minutes,
    points = excluded.points,
    rebounds = excluded.rebounds,
    offensive_rebounds = excluded.offensive_rebounds,
    defensive_rebounds = excluded.defensive_rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    personal_fouls = excluded.personal_fouls,
    field_goals_made = excluded.field_goals_made,
    field_goals_attempted = excluded.field_goals_attempted,
    three_pointers_made = excluded.three_pointers_made,
    three_pointers_attempted = excluded.three_pointers_attempted,
    free_throws_made = excluded.free_throws_made,
    free_throws_attempted = excluded.free_throws_attempted,
    plus_minus = excluded.plus_minus,
    opponent_team_id = excluded.opponent_team_id,
    is_home = excluded.is_home,
    game_date = excluded.game_date,
    season = excluded.season,
    pra = excluded.pra,
    updated_at = now();
`;

function sid(id: number | null | undefined): string {
  if (id == null) return '';
  return String(id);
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (!f && !l) return '';
  return `${f} ${l}`.trim();
}

async function main() {
  const client = await pool.connect();
  try {
    // 1. Teams (dedupe by abbreviation: keep one per abbrev, e.g. min id for current franchise)
    const teamsRes = await client.query('select id, abbreviation, city, conference, division, full_name, name from raw.teams');
    const teamByAbbrev = new Map<string, (typeof teamsRes.rows)[0]>();
    for (const r of teamsRes.rows) {
      const abbr = (r.abbreviation ?? '').trim().toUpperCase();
      if (!abbr) continue;
      const existing = teamByAbbrev.get(abbr);
      if (!existing || r.id < existing.id) teamByAbbrev.set(abbr, r);
    }
    const teamsUnique = Array.from(teamByAbbrev.values());
    const rawTeamIdToChosenId = new Map<number, number>();
    for (const r of teamsRes.rows) {
      const abbr = (r.abbreviation ?? '').trim().toUpperCase();
      if (!abbr) continue;
      const chosen = teamByAbbrev.get(abbr);
      if (chosen) rawTeamIdToChosenId.set(r.id, chosen.id);
    }
    const mapTeamId = (rawId: number | null | undefined): string => {
      if (rawId == null) return '';
      const chosen = rawTeamIdToChosenId.get(rawId) ?? rawId;
      return sid(chosen);
    };
    console.log(`Upserting ${teamsUnique.length} teams (deduped from ${teamsRes.rows.length} by abbreviation)...`);
    await client.query('begin');
    for (const r of teamsUnique) {
      await client.query(upsertTeam, [
        sid(r.id),
        r.abbreviation ?? null,
        r.full_name ?? null,
        r.name ?? null,
        r.city ?? null,
        r.conference ?? null,
        r.division ?? null,
      ]);
    }
    await client.query('commit');
    console.log('  Done.');

    // 2. Players
    const playersRes = await client.query(
      'select id, first_name, last_name, position, height, weight from raw.players',
    );
    console.log(`Upserting ${playersRes.rows.length} players...`);
    await client.query('begin');
    for (const r of playersRes.rows) {
      await client.query(upsertPlayer, [
        sid(r.id),
        fullName(r.first_name, r.last_name) || sid(r.id),
        r.first_name ?? null,
        r.last_name ?? null,
        r.position ?? null,
        r.height ?? null,
        r.weight ?? null,
      ]);
    }
    await client.query('commit');
    console.log('  Done.');

    // 3. Games (extract home/away team ids from jsonb)
    const gamesRes = await client.query(
      'select id, date, season, status, datetime, home_team_score, visitor_team_score, home_team, visitor_team from raw.games',
    );
    console.log(`Upserting ${gamesRes.rows.length} games...`);
    await client.query('begin');
    for (const g of gamesRes.rows) {
      const home = g.home_team && typeof g.home_team === 'object' ? g.home_team : null;
      const visitor = g.visitor_team && typeof g.visitor_team === 'object' ? g.visitor_team : null;
      const homeRawId = home && 'id' in home ? (home.id as number) : null;
      const awayRawId = visitor && 'id' in visitor ? (visitor.id as number) : null;
      const homeId = homeRawId != null ? mapTeamId(homeRawId) : null;
      const awayId = awayRawId != null ? mapTeamId(awayRawId) : null;
      if (!homeId || !awayId) {
        console.warn(`  Skipping game ${g.id}: missing home or visitor team id`);
        continue;
      }
      const startTime = g.datetime ?? (g.date ? new Date(g.date + 'T00:00:00Z') : null);
      await client.query(upsertGame, [
        sid(g.id),
        g.season != null ? String(g.season) : null,
        startTime,
        g.status ?? null,
        homeId,
        awayId,
        g.home_team_score ?? null,
        g.visitor_team_score ?? null,
        null,
      ]);
    }
    await client.query('commit');
    console.log('  Done.');

    // 4. Player game logs (join stats + games for derived fields)
    const logsRes = await client.query(`
      select
        s.game_id, s.player_id, s.team_id,
        s.min, s.pts, s.reb, s.oreb, s.dreb, s.ast, s.stl, s.blk, s.turnover, s.pf, s.plus_minus,
        s.fgm, s.fga, s.fg3m, s.fg3a, s.ftm, s.fta,
        g.date as game_date, g.season as game_season,
        (g.home_team->>'id')::int as home_team_id,
        (g.visitor_team->>'id')::int as away_team_id
      from raw.player_game_stats s
      join raw.games g on g.id = s.game_id
    `);
    console.log(`Upserting ${logsRes.rows.length} player game logs...`);
    const BATCH = 500;
    for (let i = 0; i < logsRes.rows.length; i += BATCH) {
      await client.query('begin');
      const batch = logsRes.rows.slice(i, i + BATCH);
      for (const r of batch) {
        const teamId = mapTeamId(r.team_id);
        const homeId = mapTeamId(r.home_team_id);
        const awayId = mapTeamId(r.away_team_id);
        const isHome = teamId === homeId;
        const opponentTeamId = isHome ? awayId : homeId;
        const gameDate = r.game_date ?? null;
        const season = r.game_season != null ? String(r.game_season) : null;
        const pra = (r.pts ?? 0) + (r.reb ?? 0) + (r.ast ?? 0);
        await client.query(upsertPlayerGameLog, [
          sid(r.game_id),
          sid(r.player_id),
          teamId,
          r.min ?? null,
          r.pts ?? null,
          r.reb ?? null,
          r.oreb ?? null,
          r.dreb ?? null,
          r.ast ?? null,
          r.stl ?? null,
          r.blk ?? null,
          r.turnover ?? null,
          r.pf ?? null,
          r.fgm ?? null,
          r.fga ?? null,
          r.fg3m ?? null,
          r.fg3a ?? null,
          r.ftm ?? null,
          r.fta ?? null,
          r.plus_minus ?? null,
          opponentTeamId || null,
          isHome,
          gameDate,
          season,
          pra,
        ]);
      }
      await client.query('commit');
      if (i + BATCH < logsRes.rows.length) console.log(`  ${Math.min(i + BATCH, logsRes.rows.length)} / ${logsRes.rows.length}`);
    }
    console.log('  Done.');
    console.log('Transform complete.');
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
