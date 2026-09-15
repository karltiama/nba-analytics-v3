/**
 * Research-only dataset export for the learned projection experiment.
 * Does not change production serving or ingestion.
 *
 *   npx tsx scripts/export-learned-projection-rows.ts
 *   npx tsx scripts/export-learned-projection-rows.ts --limit 2000
 */
import 'dotenv/config';

import { createHash } from 'crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { isPlayedGame } from '../lib/betting/minutes-projection-eval';
import {
  BENCHMARK_N,
  FEATURE_C_ALLOWLIST,
  FEATURE_D_ALLOWLIST,
  FEATURE_D_EXTRA,
  HISTORICAL_VALIDITY_CLASS,
  LEARNED_EXPERIMENT_VERSION,
  LEARNED_FEATURE_SPEC_VERSION,
  CUTOFF_POLICY_ID,
  BASKETBALL_DATE_TZ,
  RATE_MINUTES_FLOOR,
  POSSESSION_FTA_WEIGHT,
  buildLearnedRow,
  type LearnedEvalLog,
  type TeamGameContextRow,
} from '../lib/betting/player-projection-learned-features';

type LogRow = {
  player_id: string;
  game_id: string;
  team_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  start_time: Date | string;
  season: string;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_attempted: number | null;
  free_throws_attempted: number | null;
};

type TgsRow = {
  game_id: string;
  team_id: string;
  opponent_team_id: string | null;
  season: string;
  start_time: Date | string;
  team_points: number | null;
  team_fga: number | null;
  team_3pa: number | null;
  team_fta: number | null;
  team_turnovers: number | null;
  offensive_rebounds: number | null;
  points_allowed: number | null;
  opponent_fga: number | null;
  opponent_fta: number | null;
  opponent_turnovers: number | null;
  opponent_offensive_rebounds: number | null;
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function iso(v: Date | string | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function resolveCanonical(dir: string): string {
  return resolve(dir);
}

async function main() {
  const runAt = new Date().toISOString();
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null;
  const defaultOut = join('reports', 'modeling', 'learned-r1');
  const smokeOut = join('reports', 'modeling', 'learned-r1-smoke');
  const outDir = argValue('--out') ?? (limit ? smokeOut : defaultOut);
  if (limit && resolveCanonical(outDir) === resolveCanonical(defaultOut)) {
    throw new Error(
      '--limit must not write to reports/modeling/learned-r1. Use --out reports/modeling/learned-r1-smoke (the default).'
    );
  }
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 4 });
  const seasons = ['2023', '2024', '2025'];

  try {
    console.log(`${LEARNED_EXPERIMENT_VERSION} export ${runAt}`);
    const logRes = await pool.query<LogRow>(
      `
      SELECT
        l.player_id::text AS player_id,
        l.game_id::text AS game_id,
        l.team_id::text AS team_id,
        g.home_team_id::text AS home_team_id,
        g.away_team_id::text AS away_team_id,
        COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
        g.season::text AS season,
        l.minutes,
        l.points,
        l.rebounds,
        l.assists,
        l.three_pointers_made,
        l.field_goals_attempted,
        l.three_pointers_attempted,
        l.free_throws_attempted
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND g.season = ANY($1::text[])
      ORDER BY l.player_id, g.start_time
      `,
      [seasons]
    );
    console.log(`Loaded ${logRes.rows.length} Final log rows`);

    const tgsRes = await pool.query<TgsRow>(
      `
      SELECT
        t.game_id::text AS game_id,
        t.team_id::text AS team_id,
        t.opponent_team_id::text AS opponent_team_id,
        t.season::text AS season,
        g.start_time,
        t.team_points,
        t.team_fga,
        t.team_3pa,
        t.team_fta,
        t.team_turnovers,
        t.offensive_rebounds,
        t.points_allowed,
        t.opponent_fga,
        t.opponent_fta,
        t.opponent_turnovers,
        t.opponent_offensive_rebounds
      FROM analytics.team_game_stats t
      JOIN analytics.games g ON g.game_id = t.game_id
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND g.season = ANY($1::text[])
      `,
      [seasons]
    );
    console.log(`Loaded ${tgsRes.rows.length} team-game rows`);

    const gamesByPlayer = new Map<string, LearnedEvalLog[]>();
    const seen = new Set<string>();
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seen.has(k) || !row.start_time) continue;
      seen.add(k);
      const g: LearnedEvalLog = {
        game_id: row.game_id,
        player_id: row.player_id,
        team_id: row.team_id,
        home_team_id: row.home_team_id,
        away_team_id: row.away_team_id,
        start_time: iso(row.start_time),
        season: String(row.season ?? ''),
        minutes: row.minutes,
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        three_pointers_made: row.three_pointers_made,
        field_goals_attempted: row.field_goals_attempted,
        three_pointers_attempted: row.three_pointers_attempted,
        free_throws_attempted: row.free_throws_attempted,
        started: 'unknown',
      };
      const list = gamesByPlayer.get(g.player_id);
      if (list) list.push(g);
      else gamesByPlayer.set(g.player_id, [g]);
    }

    const tgsByGameTeam = new Map<string, TeamGameContextRow>();
    const teamGamesByTeam = new Map<string, TeamGameContextRow[]>();
    for (const row of tgsRes.rows) {
      if (!row.start_time) continue;
      const g: TeamGameContextRow = {
        game_id: row.game_id,
        team_id: row.team_id,
        opponent_team_id: row.opponent_team_id,
        season: String(row.season ?? ''),
        start_time: iso(row.start_time),
        team_points: row.team_points != null ? Number(row.team_points) : null,
        team_fga: row.team_fga != null ? Number(row.team_fga) : null,
        team_3pa: row.team_3pa != null ? Number(row.team_3pa) : null,
        team_fta: row.team_fta != null ? Number(row.team_fta) : null,
        team_turnovers: row.team_turnovers != null ? Number(row.team_turnovers) : null,
        offensive_rebounds: row.offensive_rebounds != null ? Number(row.offensive_rebounds) : null,
        points_allowed: row.points_allowed != null ? Number(row.points_allowed) : null,
        opponent_fga: row.opponent_fga != null ? Number(row.opponent_fga) : null,
        opponent_fta: row.opponent_fta != null ? Number(row.opponent_fta) : null,
        opponent_turnovers: row.opponent_turnovers != null ? Number(row.opponent_turnovers) : null,
        opponent_offensive_rebounds:
          row.opponent_offensive_rebounds != null ? Number(row.opponent_offensive_rebounds) : null,
      };
      tgsByGameTeam.set(`${g.game_id}|${g.team_id}`, g);
      const list = teamGamesByTeam.get(g.team_id);
      if (list) list.push(g);
      else teamGamesByTeam.set(g.team_id, [g]);
    }
    for (const list of teamGamesByTeam.values()) {
      list.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
    }

    mkdirSync(outDir, { recursive: true });
    const rowsPath = join(outDir, 'rows.jsonl');
    const hash = createHash('sha256');
    const out = createWriteStream(rowsPath, { encoding: 'utf8' });
    const recon = {
      logs: logRes.rows.length,
      tgs: tgsRes.rows.length,
      abEligible: { train: 0, validation: 0, test: 0, excluded: 0 },
      commonEligible: { train: 0, validation: 0, test: 0, excluded: 0 },
      abOnly: 0,
      leakageAb: 0,
      leakageCd: 0,
      skippedNotPlayed: 0,
      skippedNoAbPrior: 0,
      cdPriorIncludesTargetGame: 0,
    };

    let emitted = 0;
    for (const [, rawGames] of gamesByPlayer) {
      const games = rawGames.slice().sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
      for (let i = 0; i < games.length; i += 1) {
        const target = games[i];
        if (!isPlayedGame(target)) {
          recon.skippedNotPlayed += 1;
          continue;
        }
        const row = buildLearnedRow({
          allPlayerGames: games.slice(0, i + 1),
          target,
          tgsByGameTeam,
          teamGamesByTeam,
        });
        if (!row) {
          recon.skippedNoAbPrior += 1;
          continue;
        }
        recon.abEligible[row.meta.split] += 1;
        if (row.commonEligible) recon.commonEligible[row.meta.split] += 1;
        else recon.abOnly += 1;
        recon.leakageAb += row.meta.ab_leakage;
        recon.leakageCd += row.meta.cd_leakage;
        recon.cdPriorIncludesTargetGame += row.meta.cd_includes_target_game;
        const featuresDExtra: Record<string, number | null> = {};
        for (const name of FEATURE_D_EXTRA) featuresDExtra[name] = row.featuresD[name] ?? null;
        const line =
          JSON.stringify({
            player_id: row.meta.player_id,
            game_id: row.meta.game_id,
            season: row.meta.season,
            start_time: row.meta.start_time,
            basketball_date: row.meta.basketball_date,
            team_id: row.meta.team_id,
            opponent_team_id: row.meta.opponent_team_id,
            split: row.meta.split,
            cutoff_policy: row.meta.cutoff_policy,
            feature_spec_version: row.meta.feature_spec_version,
            historical_validity_class: row.meta.historical_validity_class,
            ab_prior_played_count: row.meta.ab_prior_played_count,
            cd_prior_played_count: row.meta.cd_prior_played_count,
            common_eligible: row.commonEligible,
            minutes_change_bucket: row.meta.minutes_change_bucket,
            volume_bucket: row.meta.volume_bucket,
            limited_history: row.meta.limited_history,
            pred_a_points: row.predA.points,
            pred_a_rebounds: row.predA.rebounds,
            pred_a_assists: row.predA.assists,
            pred_a_threes: row.predA.threes,
            pred_b_points: row.predB.points,
            pred_b_rebounds: row.predB.rebounds,
            pred_b_assists: row.predB.assists,
            pred_b_threes: row.predB.threes,
            actual_pts: row.labels.actual_pts,
            actual_reb: row.labels.actual_reb,
            actual_ast: row.labels.actual_ast,
            actual_threes: row.labels.actual_threes,
            actual_pra: row.labels.actual_pra,
            features_c: row.featuresC,
            features_d_extra: featuresDExtra,
          }) + '\n';
        hash.update(line);
        if (!out.write(line)) {
          await new Promise<void>((resolve) => out.once('drain', resolve));
        }
        emitted += 1;
        if (emitted % 2000 === 0) console.log(`Wrote ${emitted} rows...`);
        if (limit && emitted >= limit) break;
      }
      if (limit && emitted >= limit) break;
    }
    out.end();
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });
    const datasetHash = hash.digest('hex');

    const spec = {
      feature_spec_version: LEARNED_FEATURE_SPEC_VERSION,
      experiment_version: LEARNED_EXPERIMENT_VERSION,
      cutoff_policy: CUTOFF_POLICY_ID,
      basketball_date_tz: BASKETBALL_DATE_TZ,
      historical_validity_class: HISTORICAL_VALIDITY_CLASS,
      rate_minutes_floor: RATE_MINUTES_FLOOR,
      possession_fta_weight: POSSESSION_FTA_WEIGHT,
      feature_c_allowlist: FEATURE_C_ALLOWLIST,
      feature_d_allowlist: FEATURE_D_ALLOWLIST,
      feature_d_extra: FEATURE_D_EXTRA,
      label_fields: ['actual_pts', 'actual_reb', 'actual_ast', 'actual_threes', 'actual_pra'],
      notes: [
        'Reconstructed historical data: original publication timestamps and retrospective corrections are not fully observable.',
        'A/B use start_time < tipoff. C/D features exclude the target America/New_York basketball date.',
        'Starting frequency is excluded (2023/2024 have no certified pregame or as-of starter tape).',
        'Injury observations from 2026-03-10 to 2026-05-06 overlap 2025–26 but are excluded from this model.',
        'Team estimated possessions and ratings are reconstructed from counting stats for all three seasons. They are not stored pace and are not labeled pace per 48.',
      ],
    };
    writeFileSync(join(outDir, 'feature_spec.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');

    const benchmark = BENCHMARK_N;
    const reconciliation = {
      run_at: runAt,
      dataset_sha256: datasetHash,
      rows_path: rowsPath,
      n_written: emitted,
      leakage_ab_total: recon.leakageAb,
      leakage_cd_total: recon.leakageCd,
      cd_prior_includes_target_game: recon.cdPriorIncludesTargetGame,
      skipped_not_played: recon.skippedNotPlayed,
      skipped_no_ab_prior: recon.skippedNoAbPrior,
      ab_eligible: recon.abEligible,
      common_eligible: recon.commonEligible,
      ab_only_not_common: recon.abOnly,
      benchmark_n: benchmark,
      delta_vs_benchmark: {
        train: recon.abEligible.train - benchmark.train,
        validation: recon.abEligible.validation - benchmark.validation,
        test: recon.abEligible.test - benchmark.test,
      },
      common_eligible_delta_vs_ab: {
        train: recon.abEligible.train - recon.commonEligible.train,
        validation: recon.abEligible.validation - recon.commonEligible.validation,
        test: recon.abEligible.test - recon.commonEligible.test,
      },
      temporal_validity: {
        cutoff_policy: CUTOFF_POLICY_ID,
        basketball_date_tz: BASKETBALL_DATE_TZ,
        leakage_ab_must_be_zero: recon.leakageAb === 0,
        leakage_cd_must_be_zero: recon.leakageCd === 0,
        target_game_not_in_cd_priors: recon.cdPriorIncludesTargetGame === 0,
        dnp_targets_excluded: recon.skippedNotPlayed,
        missing_ab_history_excluded: recon.skippedNoAbPrior,
      },
      explanation:
        recon.abEligible.train === benchmark.train &&
        recon.abEligible.validation === benchmark.validation &&
        recon.abEligible.test === benchmark.test
          ? 'A/B eligible counts match the frozen v1 benchmark.'
          : 'A/B eligible counts differ from the frozen v1 benchmark. Compare models on common_eligible rows. Do not force the 27653/27696/28130 counts. Date-cutoff rows can remain A/B-only.',
    };
    writeFileSync(join(outDir, 'reconciliation.json'), JSON.stringify(reconciliation, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(reconciliation, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
