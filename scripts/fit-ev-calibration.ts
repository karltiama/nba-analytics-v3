import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Pool } from 'pg';
import {
  computePlayerPropProbability,
  computeUpgradedPlayerPropProbability,
} from '../lib/betting/player-prop-model';

type Row = {
  prop_type: string;
  side: 'over' | 'under';
  line_value: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
  last10_avg: number;
  season_avg: number;
  last5_avg: number;
  stddev10: number;
};

type Cal = { slope: number; intercept: number };

function parseArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number.parseInt(process.argv[i + 1] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function statValue(r: Row): number | null {
  const t = (r.prop_type ?? '').toLowerCase();
  if (t === 'points' || t === 'pts') return r.points;
  if (t === 'rebounds' || t === 'reb') return r.rebounds;
  if (t === 'assists' || t === 'ast') return r.assists;
  if (t === 'threes') return r.three_pointers_made;
  if (t === 'points_rebounds_assists' || t === 'pra') {
    return (r.points ?? 0) + (r.rebounds ?? 0) + (r.assists ?? 0);
  }
  return null;
}

function fitLinearCalibration(samples: Array<{ p: number; y: 0 | 1 }>): Cal {
  if (samples.length < 100) return { slope: 1, intercept: 0 };
  const meanP = samples.reduce((a, s) => a + s.p, 0) / samples.length;
  const meanY = samples.reduce((a, s) => a + s.y, 0) / samples.length;
  let cov = 0;
  let varP = 0;
  for (const s of samples) {
    cov += (s.p - meanP) * (s.y - meanY);
    varP += (s.p - meanP) * (s.p - meanP);
  }
  if (varP <= 1e-8) return { slope: 1, intercept: 0 };
  const rawSlope = cov / varP;
  const rawIntercept = meanY - rawSlope * meanP;

  // Shrink toward identity to reduce overfit.
  const lambda = 0.35;
  const slope = lambda * 1 + (1 - lambda) * rawSlope;
  const intercept = lambda * 0 + (1 - lambda) * rawIntercept;
  return {
    slope: Number.isFinite(slope) ? slope : 1,
    intercept: Number.isFinite(intercept) ? intercept : 0,
  };
}

async function main() {
  const days = parseArg('--days', 45);
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  const sql = `
    with settled as (
      select
        p.prop_type,
        p.side,
        p.line_value::float8 as line_value,
        gl.points,
        gl.rebounds,
        gl.assists,
        gl.three_pointers_made,
        avg(case
          when p.prop_type in ('points','pts') then gl2.points::float8
          when p.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when p.prop_type in ('assists','ast') then gl2.assists::float8
          when p.prop_type = 'threes' then gl2.three_pointers_made::float8
          when p.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 10) as last10_avg,
        avg(case
          when p.prop_type in ('points','pts') then gl2.points::float8
          when p.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when p.prop_type in ('assists','ast') then gl2.assists::float8
          when p.prop_type = 'threes' then gl2.three_pointers_made::float8
          when p.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 5) as last5_avg,
        avg(case
          when p.prop_type in ('points','pts') then gl2.points::float8
          when p.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when p.prop_type in ('assists','ast') then gl2.assists::float8
          when p.prop_type = 'threes' then gl2.three_pointers_made::float8
          when p.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) as season_avg,
        stddev_samp(case
          when p.prop_type in ('points','pts') then gl2.points::float8
          when p.prop_type in ('rebounds','reb') then gl2.rebounds::float8
          when p.prop_type in ('assists','ast') then gl2.assists::float8
          when p.prop_type = 'threes' then gl2.three_pointers_made::float8
          when p.prop_type in ('points_rebounds_assists','pra') then (coalesce(gl2.points,0)+coalesce(gl2.rebounds,0)+coalesce(gl2.assists,0))::float8
          else null
        end) filter (where rn2 <= 10) as stddev10
      from analytics.player_props_current p
      join analytics.games g on g.game_id::text = p.game_id::text
      join analytics.player_game_logs gl
        on gl.game_id::text = p.game_id::text and gl.player_id::text = p.player_id::text
      join lateral (
        select glx.*,
               row_number() over (order by glx.game_date desc) as rn2
        from analytics.player_game_logs glx
        where glx.player_id::text = p.player_id::text
          and glx.game_date < g.start_time::date
      ) gl2 on true
      where g.status='Final'
        and g.start_time >= now() - ($1::text || ' days')::interval
        and p.market_type='over_under'
        and p.side in ('over','under')
      group by p.prop_type,p.side,p.line_value,gl.points,gl.rebounds,gl.assists,gl.three_pointers_made
    )
    select * from settled
  `;

  const res = await pool.query<Row>(sql, [String(days)]);
  const byPropA = new Map<string, Array<{ p: number; y: 0 | 1 }>>();
  const byPropB = new Map<string, Array<{ p: number; y: 0 | 1 }>>();

  for (const r of res.rows) {
    const stat = statValue(r);
    if (stat == null) continue;
    const win: 0 | 1 = ((r.side === 'over' ? stat > r.line_value : stat < r.line_value) ? 1 : 0);
    const baseOver = computePlayerPropProbability({
      last10Avg: r.last10_avg,
      seasonAvg: r.season_avg,
      line: r.line_value,
      propType: r.prop_type,
    }).probability;
    const upOver = computeUpgradedPlayerPropProbability({
      last10Avg: r.last10_avg,
      seasonAvg: r.season_avg,
      line: r.line_value,
      propType: r.prop_type,
      last5Avg: r.last5_avg,
      observedStdDev: r.stddev10,
    }).probability;
    const pA = clamp01(r.side === 'under' ? 1 - baseOver : baseOver);
    const pB = clamp01(r.side === 'under' ? 1 - upOver : upOver);
    const key = (r.prop_type ?? '').toLowerCase();
    if (!byPropA.has(key)) byPropA.set(key, []);
    if (!byPropB.has(key)) byPropB.set(key, []);
    byPropA.get(key)!.push({ p: pA, y: win });
    byPropB.get(key)!.push({ p: pB, y: win });
  }

  const trackA: Record<string, Cal> = { default: { slope: 1, intercept: 0 } };
  const trackB: Record<string, Cal> = { default: { slope: 1, intercept: 0 } };
  for (const [k, rows] of byPropA.entries()) trackA[k] = fitLinearCalibration(rows);
  for (const [k, rows] of byPropB.entries()) trackB[k] = fitLinearCalibration(rows);

  const output = {
    version: `v1-fit-${new Date().toISOString().slice(0, 10)}`,
    tracks: { trackA, trackB },
  };
  writeFileSync(
    'C:/Users/tiama/Desktop/Coding/nba-analytics-v3/lib/betting/ev-calibration-artifacts.json',
    JSON.stringify(output, null, 2) + '\n',
    'utf-8'
  );
  console.log(`Wrote calibration artifacts for ${res.rowCount} rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
