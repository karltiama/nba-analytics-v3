import 'dotenv/config';
import pool, { query } from '@/lib/db';
import { WOWY_POSTSEASON_START_ET } from '@/lib/wowy/calendar';

async function main() {
  const season = '2025';
  const floor = WOWY_POSTSEASON_START_ET[season]!;

  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='raw' AND table_name='games' ORDER BY ordinal_position`
  );
  console.log('raw.games columns', cols.map((c: { column_name: string }) => c.column_name));

  const special = await query(
    `SELECT rg.id::text, rg.postseason, rg.date::text, rg.status, rg.season,
            rg.home_team, rg.visitor_team, rg.home_team_score, rg.visitor_team_score,
            rg.time, rg.period
     FROM raw.games rg
     WHERE rg.id::text IN ('20314126','20054036','20377171')`
  );
  console.log('special raw', special);

  // NYK prefixes
  const nyk = await query(
    `SELECT left(tgs.game_id, 3) AS prefix, count(*)::int AS n,
            array_agg(tgs.game_id ORDER BY g.start_time) AS ids,
            array_agg(opp.abbreviation ORDER BY g.start_time) AS opps,
            array_agg((timezone('America/New_York', g.start_time))::date::text ORDER BY g.start_time) AS tips
     FROM analytics.team_game_stats tgs
     JOIN analytics.games g ON g.game_id = tgs.game_id
     JOIN analytics.teams t ON t.team_id = tgs.team_id AND t.abbreviation = 'NYK'
     JOIN analytics.teams opp ON opp.team_id = tgs.opponent_team_id
     WHERE tgs.season = $1
       AND (timezone('America/New_York', g.start_time))::date < $2::date
     GROUP BY 1 ORDER BY 1`,
    [season, floor]
  );
  console.log('NYK prefixes', nyk);

  // League-wide: which game_ids appear in RS for teams with gp=83 only?
  const excessCandidates = await query(
    `WITH team_gp AS (
       SELECT tgs.team_id, t.abbreviation, count(*)::int AS gp
       FROM analytics.team_game_stats tgs
       JOIN analytics.games g ON g.game_id = tgs.game_id
       JOIN analytics.teams t ON t.team_id = tgs.team_id
       WHERE tgs.season = $1
         AND (timezone('America/New_York', g.start_time))::date < $2::date
       GROUP BY tgs.team_id, t.abbreviation
     ),
     odd AS (SELECT team_id, abbreviation FROM team_gp WHERE gp = 83)
     SELECT tgs.game_id, left(tgs.game_id,3) AS prefix,
            array_agg(DISTINCT o.abbreviation ORDER BY o.abbreviation) AS odd_teams,
            count(DISTINCT tgs.team_id)::int AS all_team_rows,
            min((timezone('America/New_York', g.start_time))::date::text) AS tip_et
     FROM analytics.team_game_stats tgs
     JOIN analytics.games g ON g.game_id = tgs.game_id
     JOIN odd o ON o.team_id = tgs.team_id
     WHERE tgs.season = $1
       AND (timezone('America/New_York', g.start_time))::date < $2::date
       AND left(tgs.game_id, 3) <> '184'
     GROUP BY tgs.game_id
     ORDER BY tip_et`,
    [season, floor]
  );
  console.log('non-184 games on 83-gp teams', excessCandidates);

  // Same matchup same calendar day with different game_ids?
  const sameDayDup = await query(
    `SELECT a.game_id AS a_id, b.game_id AS b_id,
            ta.abbreviation AS team, oa.abbreviation AS opp,
            (timezone('America/New_York', ga.start_time))::date::text AS tip_et
     FROM analytics.team_game_stats a
     JOIN analytics.games ga ON ga.game_id = a.game_id
     JOIN analytics.teams ta ON ta.team_id = a.team_id
     JOIN analytics.teams oa ON oa.team_id = a.opponent_team_id
     JOIN analytics.team_game_stats b
       ON b.team_id = a.team_id AND b.season = a.season AND b.game_id <> a.game_id
       AND b.opponent_team_id = a.opponent_team_id
     JOIN analytics.games gb ON gb.game_id = b.game_id
     WHERE a.season = $1
       AND ta.abbreviation IN ('SAS','NYK')
       AND (timezone('America/New_York', ga.start_time))::date
         = (timezone('America/New_York', gb.start_time))::date
       AND a.game_id < b.game_id
     ORDER BY tip_et`,
    [season]
  );
  console.log('same-day same-opponent dup ids', sameDayDup);

  // Exclude only 20377171: league dist
  const exclOne = await query(
    `SELECT gp, count(*)::int AS teams
     FROM (
       SELECT tgs.team_id, count(*)::int AS gp
       FROM analytics.team_game_stats tgs
       JOIN analytics.games g ON g.game_id = tgs.game_id
       WHERE tgs.season = $1
         AND tgs.game_id <> '20377171'
         AND (timezone('America/New_York', g.start_time))::date < $2::date
       GROUP BY tgs.team_id
     ) x GROUP BY gp ORDER BY gp DESC`,
    [season, floor]
  );
  console.log('gp dist excluding only 20377171', exclOne);

  // What are 200/203 games league-wide?
  const allSpecial = await query(
    `SELECT left(tgs.game_id,3) AS prefix, count(DISTINCT tgs.game_id)::int AS games,
            count(*)::int AS team_rows,
            min((timezone('America/New_York', g.start_time))::date::text) AS first_tip,
            max((timezone('America/New_York', g.start_time))::date::text) AS last_tip
     FROM analytics.team_game_stats tgs
     JOIN analytics.games g ON g.game_id = tgs.game_id
     WHERE tgs.season = $1
       AND left(tgs.game_id,3) IN ('200','203')
       AND (timezone('America/New_York', g.start_time))::date < $2::date
     GROUP BY 1`,
    [season, floor]
  );
  console.log('league 200/203 in RS window', allSpecial);

  const allSpecialGames = await query(
    `SELECT DISTINCT tgs.game_id, left(tgs.game_id,3) AS prefix,
            (timezone('America/New_York', g.start_time))::date::text AS tip_et,
            array_agg(t.abbreviation ORDER BY t.abbreviation) AS teams
     FROM analytics.team_game_stats tgs
     JOIN analytics.games g ON g.game_id = tgs.game_id
     JOIN analytics.teams t ON t.team_id = tgs.team_id
     WHERE tgs.season = $1
       AND left(tgs.game_id,3) IN ('200','203')
       AND (timezone('America/New_York', g.start_time))::date < $2::date
     GROUP BY tgs.game_id, tip_et
     ORDER BY tip_et, tgs.game_id`,
    [season, floor]
  );
  console.log('all 200/203 games', allSpecialGames);

  // Opponent meeting counts >4 for any team
  const over4 = await query(
    `SELECT t.abbreviation, opp.abbreviation AS opp, count(*)::int AS n
     FROM analytics.team_game_stats tgs
     JOIN analytics.games g ON g.game_id = tgs.game_id
     JOIN analytics.teams t ON t.team_id = tgs.team_id
     JOIN analytics.teams opp ON opp.team_id = tgs.opponent_team_id
     WHERE tgs.season = $1
       AND (timezone('America/New_York', g.start_time))::date < $2::date
     GROUP BY t.abbreviation, opp.abbreviation
     HAVING count(*) > 4
     ORDER BY n DESC, t.abbreviation`,
    [season, floor]
  );
  console.log('matchups with >4 RS meetings', over4);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
