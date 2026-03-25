/**
 * Offline EV evaluation harness.
 *
 * Usage:
 *   npx tsx scripts/evaluate-ev-signal.ts
 *   npx tsx scripts/evaluate-ev-signal.ts --days 30
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { computePlayerPropProbability, computeUpgradedPlayerPropProbability } from '../lib/betting/player-prop-model';
import { brierScore, expectedCalibrationError, decileScorecard } from '../lib/betting/ev-eval-metrics';
import { calibrateProbability } from '../lib/betting/ev-calibration';

type EvalRow = {
  game_id: string;
  player_id: string;
  prop_type: string;
  side: 'over' | 'under';
  line_value: number;
  odds_american: number;
  odds_decimal: number | null;
  stat_value: number;
  last10_avg: number;
  season_avg: number;
  last5_avg: number;
  stddev10: number;
};

function parseArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number.parseInt(process.argv[i + 1] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

function americanToDecimal(odds: number): number {
  return odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
}

async function main() {
  const days = parseArg('--days', 21);
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const sql = `
    with latest_lines as (
      select
        h.game_id::text,
        h.player_id::text,
        h.prop_type,
        h.side,
        h.line_value::float8 as line_value,
        h.odds_american,
        h.odds_decimal,
        row_number() over (
          partition by h.game_id, h.player_id, h.prop_type, h.side, h.line_value
          order by h.snapshot_at desc
        ) as rn
      from analytics.player_props_current h
      join analytics.games g on g.game_id::text = h.game_id::text
      where g.status = 'Final'
        and g.start_time >= now() - ($1::text || ' days')::interval
        and h.market_type = 'over_under'
        and h.side in ('over', 'under')
    ),
    chosen as (
      select
        game_id, player_id, prop_type, side, line_value, odds_american, odds_decimal
      from latest_lines
      where rn = 1
    ),
    stats as (
      select
        c.*,
        gl.points,
        gl.rebounds,
        gl.assists,
        gl.three_pointers_made,
        avg(case
          when c.prop_type in ('points','pts') then gl2.points::float8
          when c.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when c.prop_type in ('assists','ast') then gl2.assists::float8
          when c.prop_type = 'threes' then gl2.three_pointers_made::float8
          when c.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_assists','pa') then (coalesce(gl2.points,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_rebounds','pr') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0))::float8
          when c.prop_type in ('rebounds_assists','ra') then (coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 10) as last10_avg,
        avg(case
          when c.prop_type in ('points','pts') then gl2.points::float8
          when c.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when c.prop_type in ('assists','ast') then gl2.assists::float8
          when c.prop_type = 'threes' then gl2.three_pointers_made::float8
          when c.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_assists','pa') then (coalesce(gl2.points,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_rebounds','pr') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0))::float8
          when c.prop_type in ('rebounds_assists','ra') then (coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 5) as last5_avg,
        avg(case
          when c.prop_type in ('points','pts') then gl2.points::float8
          when c.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when c.prop_type in ('assists','ast') then gl2.assists::float8
          when c.prop_type = 'threes' then gl2.three_pointers_made::float8
          when c.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_assists','pa') then (coalesce(gl2.points,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_rebounds','pr') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0))::float8
          when c.prop_type in ('rebounds_assists','ra') then (coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) as season_avg,
        stddev_samp(case
          when c.prop_type in ('points','pts') then gl2.points::float8
          when c.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when c.prop_type in ('assists','ast') then gl2.assists::float8
          when c.prop_type = 'threes' then gl2.three_pointers_made::float8
          when c.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_assists','pa') then (coalesce(gl2.points,0)+coalesce(gl2.assists,0))::float8
          when c.prop_type in ('points_rebounds','pr') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0))::float8
          when c.prop_type in ('rebounds_assists','ra') then (coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 10) as stddev10
      from chosen c
      join analytics.player_game_logs gl
        on gl.game_id::text = c.game_id and gl.player_id::text = c.player_id
      join lateral (
        select glx.*,
               row_number() over (order by glx.game_date desc) as rn2
        from analytics.player_game_logs glx
        where glx.player_id::text = c.player_id
          and glx.game_date < (select g.start_time::date from analytics.games g where g.game_id::text = c.game_id)
      ) gl2 on true
      group by c.game_id, c.player_id, c.prop_type, c.side, c.line_value, c.odds_american, c.odds_decimal,
               gl.points, gl.rebounds, gl.assists, gl.three_pointers_made
    )
    select
      game_id, player_id, prop_type, side, line_value, odds_american, odds_decimal,
      case
        when prop_type in ('points','pts') then points::float8
        when prop_type in ('rebounds','reb') then rebounds::float8
        when prop_type in ('assists','ast') then assists::float8
        when prop_type = 'threes' then three_pointers_made::float8
        when prop_type in ('points_rebounds_assists','pra') then (coalesce(points,0)+coalesce(rebounds,0)+coalesce(assists,0))::float8
        when prop_type in ('points_assists','pa') then (coalesce(points,0)+coalesce(assists,0))::float8
        when prop_type in ('points_rebounds','pr') then (coalesce(points,0)+coalesce(rebounds,0))::float8
        when prop_type in ('rebounds_assists','ra') then (coalesce(rebounds,0)+coalesce(assists,0))::float8
        else null
      end as stat_value,
      coalesce(last10_avg, 0) as last10_avg,
      coalesce(season_avg, 0) as season_avg,
      coalesce(last5_avg, coalesce(last10_avg, 0)) as last5_avg,
      coalesce(stddev10, 0) as stddev10
    from stats
  `;

  const result = await pool.query<EvalRow>(sql, [String(days)]);
  const rows = result.rows.filter((r) => Number.isFinite(r.stat_value));
  if (rows.length === 0) {
    console.log('No rows returned for evaluation window.');
    await pool.end();
    return;
  }

  const baseline = rows.map((r) => {
    const pOver = computePlayerPropProbability({
      last10Avg: r.last10_avg,
      seasonAvg: r.season_avg,
      line: r.line_value,
      propType: r.prop_type,
    }).probability;
    const p = r.side === 'under' ? 1 - pOver : pOver;
    const win = (r.side === 'over' ? r.stat_value > r.line_value : r.stat_value < r.line_value) ? 1 : 0;
    const dec = r.odds_decimal ?? americanToDecimal(r.odds_american);
    const ev = p * dec - 1;
    const roi = win ? dec - 1 : -1;
    return { p, win: win as 0 | 1, ev, roi };
  });

  const upgraded = rows.map((r) => {
    const pOver = computeUpgradedPlayerPropProbability({
      last10Avg: r.last10_avg,
      seasonAvg: r.season_avg,
      line: r.line_value,
      propType: r.prop_type,
      last5Avg: r.last5_avg,
      observedStdDev: r.stddev10,
    }).probability;
    const p = r.side === 'under' ? 1 - pOver : pOver;
    const win = (r.side === 'over' ? r.stat_value > r.line_value : r.stat_value < r.line_value) ? 1 : 0;
    const dec = r.odds_decimal ?? americanToDecimal(r.odds_american);
    const ev = p * dec - 1;
    const roi = win ? dec - 1 : -1;
    return { p, win: win as 0 | 1, ev, roi };
  });

  const summary = {
    rows: rows.length,
    baseline: {
      brier: brierScore(baseline),
      ece10: expectedCalibrationError(baseline, 10),
      deciles: decileScorecard(baseline),
    },
    trackA: {
      brier: brierScore(
        rows.map((r, i) => {
          const p = calibrateProbability(baseline[i]?.p ?? 0.5, r.prop_type, 'trackA');
          return { ...baseline[i]!, p };
        })
      ),
      ece10: expectedCalibrationError(
        rows.map((r, i) => {
          const p = calibrateProbability(baseline[i]?.p ?? 0.5, r.prop_type, 'trackA');
          const base = baseline[i]!;
          return { ...base, p, ev: p * (((r.odds_decimal ?? americanToDecimal(r.odds_american)))) - 1 };
        }),
        10
      ),
      deciles: decileScorecard(
        rows.map((r, i) => {
          const p = calibrateProbability(baseline[i]?.p ?? 0.5, r.prop_type, 'trackA');
          const base = baseline[i]!;
          return { ...base, p, ev: p * (((r.odds_decimal ?? americanToDecimal(r.odds_american)))) - 1 };
        })
      ),
    },
    upgraded: {
      brier: brierScore(upgraded),
      ece10: expectedCalibrationError(upgraded, 10),
      deciles: decileScorecard(upgraded),
    },
    trackB: {
      brier: brierScore(
        rows.map((r, i) => {
          const p = calibrateProbability(upgraded[i]?.p ?? 0.5, r.prop_type, 'trackB');
          return { ...upgraded[i]!, p };
        })
      ),
      ece10: expectedCalibrationError(
        rows.map((r, i) => {
          const p = calibrateProbability(upgraded[i]?.p ?? 0.5, r.prop_type, 'trackB');
          const up = upgraded[i]!;
          return { ...up, p, ev: p * (((r.odds_decimal ?? americanToDecimal(r.odds_american)))) - 1 };
        }),
        10
      ),
      deciles: decileScorecard(
        rows.map((r, i) => {
          const p = calibrateProbability(upgraded[i]?.p ?? 0.5, r.prop_type, 'trackB');
          const up = upgraded[i]!;
          return { ...up, p, ev: p * (((r.odds_decimal ?? americanToDecimal(r.odds_american)))) - 1 };
        })
      ),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
