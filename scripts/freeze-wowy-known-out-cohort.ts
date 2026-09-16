/**
 * Freeze the known-Out cohort after last-observed freshness and a reconciled waterfall.
 * Read-only. Does not train.
 *
 *   npx tsx scripts/freeze-wowy-known-out-cohort.ts
 */
import 'dotenv/config';

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { classifyWowyAppearance } from '../lib/wowy/appearance';
import { classifyWowyGames } from '../lib/wowy/eligibility';
import { isUsableWowyPrior } from '../lib/wowy/cutoff';
import { etCalendarDate } from '../lib/wowy/calendar';
import {
  buildWowyCandidateFeatures,
  rankTeammatesByPriorMinutes,
  WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES,
  WOWY_R1_MIN_PRIMARY_SHARED_GAMES,
  type WowyRosterAppearance,
} from '../lib/wowy/candidate-features';
import { wowySupportTier } from '../lib/wowy/policy';
import {
  hadObservationOnOrAfterCutoff,
  intendedCutoffIso,
  KNOWN_OUT_TERMINAL_REASONS,
  selectKnownOutObservation,
  uniqueGameForTeamEtDate,
  WOWY_R1_OBS_FRESHNESS_MAX_HOURS,
  WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP,
  type TeamGameRef,
} from '../lib/wowy/known-out-association';
import type { PregameAvailabilityObservation } from '../lib/wowy/availability-gate';
import type { WowyLoadedGame, WowyPairQuery } from '../lib/wowy/types';

const url = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');

const WINDOW_FROM = '2026-03-10T00:00:00.000Z';
const WINDOW_TO = '2026-05-07T00:00:00.000Z';
const SEASON = '2025';
const OUT_DIR = 'reports/modeling/wowy-known-out-r1';

type LogRow = {
  player_id: string;
  game_id: string;
  team_id: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_attempted: number | null;
  free_throws_attempted: number | null;
  start_time: Date;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  opponent_team_id: string | null;
  season: string;
};

function toIso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
  const waterfall: Record<string, number> = {};
  for (const r of KNOWN_OUT_TERMINAL_REASONS) waterfall[r] = 0;
  const diagnostic = {
    not_played_in_window: 0,
    no_precutoff_but_had_postcutoff_obs: 0,
    history_change_stale_raw_fresh_eligible: 0,
    raw_membership_table_present: false,
  };

  try {
    const logsRes = await pool.query<LogRow>(
      `SELECT l.player_id::text AS player_id,
              l.game_id::text AS game_id,
              l.team_id::text AS team_id,
              l.minutes,
              l.points,
              l.rebounds,
              l.assists,
              l.three_pointers_made,
              l.field_goals_attempted,
              l.three_pointers_attempted,
              l.free_throws_attempted,
              g.start_time,
              g.status,
              g.home_score,
              g.away_score,
              g.home_team_id::text AS home_team_id,
              g.away_team_id::text AS away_team_id,
              l.opponent_team_id::text AS opponent_team_id,
              l.season
       FROM analytics.player_game_logs l
       JOIN analytics.games g ON g.game_id = l.game_id
       WHERE l.season = $1
         AND g.status = 'Final'
         AND g.start_time IS NOT NULL
         AND g.home_score IS NOT NULL
         AND g.away_score IS NOT NULL`,
      [SEASON]
    );

    const mem = await pool.query<{ exists: boolean }>(
      `SELECT exists (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'raw' AND table_name = 'injury_pull_membership'
       ) AS exists`
    );
    diagnostic.raw_membership_table_present = Boolean(mem.rows[0]?.exists);

    const rawRes = await pool.query<{
      player_id: string;
      team_id: string | null;
      status: string | null;
      created_at: Date;
    }>(
      `SELECT i.provider_player_id::text AS player_id,
              t.team_id::text AS team_id,
              i.status,
              i.created_at
       FROM raw.player_injuries i
       JOIN raw.injury_pull_runs r ON r.pull_run_id = i.pull_run_id
       LEFT JOIN raw.teams rt ON rt.id = i.provider_team_id
       LEFT JOIN analytics.teams t ON upper(trim(t.abbreviation)) = upper(trim(rt.abbreviation))
       WHERE r.status = 'success'
         AND r.completed_at IS NOT NULL
         AND i.created_at IS NOT NULL`
    );

    const histRes = await pool.query<{
      player_id: string;
      team_id: string | null;
      status: string;
      snapshot_at: Date;
    }>(
      `SELECT player_id::text AS player_id, team_id::text AS team_id, status, snapshot_at
       FROM analytics.player_injury_status_history`
    );

    const rawObs: PregameAvailabilityObservation[] = rawRes.rows
      .filter((r) => r.team_id && r.status)
      .map((r) => ({
        playerId: r.player_id,
        teamId: r.team_id,
        status: String(r.status).trim(),
        snapshotAt: toIso(r.created_at),
      }));
    const histObs: PregameAvailabilityObservation[] = histRes.rows.map((r) => ({
      playerId: r.player_id,
      teamId: r.team_id,
      status: r.status,
      snapshotAt: toIso(r.snapshot_at),
    }));

    const teamGames: TeamGameRef[] = [];
    const seenTeamGame = new Set<string>();
    for (const row of logsRes.rows) {
      const start = toIso(row.start_time);
      for (const tid of [row.home_team_id, row.away_team_id]) {
        if (!tid) continue;
        const k = `${row.game_id}|${tid}`;
        if (seenTeamGame.has(k)) continue;
        seenTeamGame.add(k);
        teamGames.push({ gameId: row.game_id, teamId: tid, startTime: start });
      }
    }

    const logsByPlayerTeam = new Map<string, LogRow[]>();
    const logByGamePlayer = new Map<string, LogRow>();
    const appearancesByTeam = new Map<string, WowyRosterAppearance[]>();
    for (const row of logsRes.rows) {
      const key = `${row.player_id}|${row.team_id}`;
      const list = logsByPlayerTeam.get(key) ?? [];
      list.push(row);
      logsByPlayerTeam.set(key, list);
      logByGamePlayer.set(`${row.game_id}|${row.player_id}`, row);
      const apps = appearancesByTeam.get(row.team_id) ?? [];
      apps.push({
        playerId: row.player_id,
        gameId: row.game_id,
        startTime: toIso(row.start_time),
        teamId: row.team_id,
        minutes: row.minutes,
      });
      appearancesByTeam.set(row.team_id, apps);
    }

    type PairCache = { classified: ReturnType<typeof classifyWowyGames>; games: WowyLoadedGame[] };
    const pairCache = new Map<string, PairCache>();

    function pairData(subjectId: string, teammateId: string, teamId: string): PairCache {
      const key = `${subjectId}|${teammateId}|${teamId}`;
      const hit = pairCache.get(key);
      if (hit) return hit;
      const subjectLogs = logsByPlayerTeam.get(`${subjectId}|${teamId}`) ?? [];
      const games: WowyLoadedGame[] = subjectLogs.map((row) => {
        const start = toIso(row.start_time);
        const mate = logByGamePlayer.get(`${row.game_id}|${teammateId}`);
        return {
          gameId: row.game_id,
          startTime: start,
          gameDate: start.slice(0, 10),
          season: row.season,
          status: row.status,
          homeScore: num(row.home_score),
          awayScore: num(row.away_score),
          subjectTeamId: row.team_id,
          homeTeamId: row.home_team_id,
          opponentTeamId: row.opponent_team_id,
          opponentAbbr: null,
          subjectMinutes: row.minutes,
          subjectPts: num(row.points),
          subjectReb: num(row.rebounds),
          subjectAst: num(row.assists),
          subjectTpm: num(row.three_pointers_made),
          subjectFga: num(row.field_goals_attempted),
          subjectTpa: num(row.three_pointers_attempted),
          subjectFta: num(row.free_throws_attempted),
          teammateRowPresent: Boolean(mate),
          teammateTeamId: mate?.team_id ?? null,
          teammateMinutes: mate?.minutes ?? null,
          teammatePts: num(mate?.points ?? null),
          teammateReb: num(mate?.rebounds ?? null),
          teammateAst: num(mate?.assists ?? null),
          teammateTpm: num(mate?.three_pointers_made ?? null),
          teammateFga: num(mate?.field_goals_attempted ?? null),
          teammateFta: num(mate?.free_throws_attempted ?? null),
          teamPts: null,
          teamReb: null,
          teamAst: null,
          teamTpm: null,
          teamFga: null,
          teamTpa: null,
          teamFta: null,
          teamOppPts: null,
        };
      });
      const query: WowyPairQuery = {
        subjectPlayerId: subjectId,
        teammatePlayerId: teammateId,
        season: SEASON,
        teamId,
        seasonType: 'all',
      };
      const classified = classifyWowyGames(games, query, { identityOk: true });
      const entry = { classified, games };
      pairCache.set(key, entry);
      return entry;
    }

    const windowFromMs = Date.parse(WINDOW_FROM);
    const windowToMs = Date.parse(WINDOW_TO);
    const eligible: Array<Record<string, unknown>> = [];
    const seenSubjectGame = new Set<string>();
    let sourcePlayed = 0;

    for (const row of logsRes.rows) {
      const startMs = row.start_time.getTime();
      if (startMs < windowFromMs || startMs >= windowToMs) continue;
      const subjectGameKey = `${row.player_id}|${row.game_id}`;
      if (seenSubjectGame.has(subjectGameKey)) continue;
      seenSubjectGame.add(subjectGameKey);

      const played = classifyWowyAppearance({
        minutes: row.minutes,
        points: num(row.points),
        rebounds: num(row.rebounds),
        assists: num(row.assists),
        three_pointers_made: num(row.three_pointers_made),
        field_goals_attempted: num(row.field_goals_attempted),
        free_throws_attempted: num(row.free_throws_attempted),
      });
      if (played.class !== 'played') {
        diagnostic.not_played_in_window += 1;
        continue;
      }
      sourcePlayed += 1;

      const start = toIso(row.start_time);
      const cutoff = intendedCutoffIso(start);
      if (!cutoff) {
        waterfall.missing_tip_or_cutoff += 1;
        continue;
      }

      const ranked = rankTeammatesByPriorMinutes({
        subjectPlayerId: row.player_id,
        teamId: row.team_id,
        cutoffStartTime: cutoff,
        appearances: appearancesByTeam.get(row.team_id) ?? [],
      });
      const primary = ranked[0];
      if (
        !primary ||
        primary.priorPlayedMinutes < WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES ||
        primary.priorSharedPlayedGames < WOWY_R1_MIN_PRIMARY_SHARED_GAMES
      ) {
        waterfall.no_primary_teammate += 1;
        continue;
      }

      const uniq = uniqueGameForTeamEtDate(teamGames, row.team_id, start);
      if (!('gameId' in uniq) || uniq.gameId !== row.game_id) {
        waterfall.ambiguous_team_et_date += 1;
        continue;
      }

      const histGate = selectKnownOutObservation({
        teammatePlayerId: primary.playerId,
        teamId: row.team_id,
        cutoffStartTime: cutoff,
        observations: histObs,
      });
      const rawGate = selectKnownOutObservation({
        teammatePlayerId: primary.playerId,
        teamId: row.team_id,
        cutoffStartTime: cutoff,
        observations: rawObs,
      });

      if (!rawGate.eligible) {
        const reason = rawGate.reason ?? 'no_precutoff_observation';
        if (reason === 'no_precutoff_observation') {
          waterfall.no_precutoff_observation += 1;
          if (
            hadObservationOnOrAfterCutoff({
              teammatePlayerId: primary.playerId,
              cutoffStartTime: cutoff,
              observations: rawObs,
            })
          ) {
            diagnostic.no_precutoff_but_had_postcutoff_obs += 1;
          }
        } else if (reason === 'observation_stale') {
          waterfall.observation_stale += 1;
        } else if (reason === 'status_not_explicit_out') {
          waterfall.status_not_explicit_out += 1;
        } else if (reason === 'missing_tip_or_cutoff') {
          waterfall.missing_tip_or_cutoff += 1;
        } else {
          waterfall.no_precutoff_observation += 1;
        }
        continue;
      }

      const { classified, games } = pairData(row.player_id, primary.playerId, row.team_id);
      let withN = 0;
      let withoutN = 0;
      for (const g of classified) {
        if (!g.startTime || !isUsableWowyPrior(g.startTime, cutoff)) continue;
        if (g.bucket === 'with') withN += 1;
        if (g.bucket === 'without') withoutN += 1;
      }
      const support = wowySupportTier(withN, withoutN);
      if (support === 'insufficient') {
        waterfall.insufficient_wowy_support += 1;
        continue;
      }

      if (histGate.reason === 'observation_stale') {
        diagnostic.history_change_stale_raw_fresh_eligible += 1;
      }

      const features = buildWowyCandidateFeatures({
        subjectPlayerId: row.player_id,
        subjectName: row.player_id,
        teamId: row.team_id,
        season: SEASON,
        seasonType: 'all',
        cutoffStartTime: cutoff,
        appearances: appearancesByTeam.get(row.team_id) ?? [],
        gamesByTeammate: { [primary.playerId]: games },
        observations: rawObs,
      });

      const mateLog = logByGamePlayer.get(`${row.game_id}|${primary.playerId}`);
      const matePlayed =
        mateLog != null &&
        classifyWowyAppearance({
          minutes: mateLog.minutes,
          points: num(mateLog.points),
          rebounds: num(mateLog.rebounds),
          assists: num(mateLog.assists),
          three_pointers_made: num(mateLog.three_pointers_made),
          field_goals_attempted: num(mateLog.field_goals_attempted),
          free_throws_attempted: num(mateLog.free_throws_attempted),
        }).class === 'played';

      waterfall.eligible += 1;
      eligible.push({
        player_id: row.player_id,
        game_id: row.game_id,
        team_id: row.team_id,
        teammate_id: primary.playerId,
        start_time: start,
        basketball_date_et: etCalendarDate(start),
        cutoff_start_time: cutoff,
        support_tier: support,
        last_observed_at: rawGate.usedSnapshotAt,
        last_observed_status: rawGate.usedStatus,
        last_changed_at: histGate.usedSnapshotAt,
        last_observed_age_hours: rawGate.ageHoursAtCutoff,
        teammate_ultimately_played: matePlayed,
        actual_pts: num(row.points),
        actual_reb: num(row.rebounds),
        ...features.features,
      });
    }

    const waterfallSum = Object.values(waterfall).reduce((a, b) => a + b, 0);
    if (waterfallSum !== sourcePlayed) {
      throw new Error(`Waterfall ${waterfallSum} != sourcePlayed ${sourcePlayed}`);
    }

    eligible.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    const uniqueDates = [
      ...new Set(eligible.map((r) => String(r.basketball_date_et ?? ''))),
    ]
      .filter(Boolean)
      .sort();
    const dateCutIndex = Math.max(1, Math.floor(uniqueDates.length * 0.7));
    const trainDates = new Set(uniqueDates.slice(0, dateCutIndex));
    for (const row of eligible) {
      const d = String(row.basketball_date_et ?? '');
      row.split = trainDates.has(d) ? 'train' : 'eval';
    }

    const train = eligible.filter((r) => r.split === 'train');
    const evalRows = eligible.filter((r) => r.split === 'eval');
    const hash = createHash('sha256');
    const lines = eligible.map((r) => JSON.stringify(r));
    for (const line of lines) hash.update(line);
    hash.update('\n');
    const cohortSha256 = hash.digest('hex');

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'cohort.jsonl'), `${lines.join('\n')}\n`);
    const freeze = {
      frozen_at: new Date().toISOString(),
      experiment_version: 'player-projection-wowy-known-out-r1',
      freshness: 'last_observed_from_raw_successful_pulls',
      cutoff_minutes_before_tip: WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP,
      freshness_max_hours: WOWY_R1_OBS_FRESHNESS_MAX_HOURS,
      source_population: {
        definition: 'Season 2025 Final complete games, subject played, tip in [2026-03-10, 2026-05-07)',
        n: sourcePlayed,
      },
      waterfall,
      waterfall_sum: waterfallSum,
      diagnostic,
      eligible: {
        n: eligible.length,
        train_n: train.length,
        eval_n: evalRows.length,
        train_et_dates: [...trainDates].sort(),
        eval_et_dates: uniqueDates.slice(dateCutIndex),
        distinct_game_dates: uniqueDates.length,
        distinct_games: new Set(eligible.map((r) => String(r.game_id))).size,
        distinct_players: new Set(eligible.map((r) => String(r.player_id))).size,
        distinct_teammate_pairs: new Set(eligible.map((r) => `${r.player_id}|${r.teammate_id}`)).size,
        teammate_ultimately_played: eligible.filter((r) => r.teammate_ultimately_played).length,
        teammate_verified_dnp_or_unknown: eligible.filter((r) => !r.teammate_ultimately_played).length,
        low_support: eligible.filter((r) => r.support_tier === 'low_support').length,
        adequate_support: eligible.filter((r) => r.support_tier === 'adequate').length,
      },
      cohort_sha256: cohortSha256,
      prior_arithmetic_note:
        'The 399+2300+1959+1378+837+126 vs 7083 mismatch omitted no_primary_teammate (84) and treated post-cutoff as a separate terminal bucket overlapping no-precutoff labeling. This freeze uses exclusive terminals that sum to sourcePlayed.',
    };
    writeFileSync(join(OUT_DIR, 'freeze.json'), `${JSON.stringify(freeze, null, 2)}\n`);
    writeFileSync(
      join(OUT_DIR, 'waterfall.json'),
      `${JSON.stringify({ source_n: sourcePlayed, terminal: waterfall, sum: waterfallSum, diagnostic }, null, 2)}\n`
    );

    console.log(
      JSON.stringify({
        wrote: OUT_DIR,
        sourcePlayed,
        eligible: eligible.length,
        train: train.length,
        eval: evalRows.length,
        waterfallSum,
        historyStaleRawFresh: diagnostic.history_change_stale_raw_fresh_eligible,
        cohortSha256,
      })
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
