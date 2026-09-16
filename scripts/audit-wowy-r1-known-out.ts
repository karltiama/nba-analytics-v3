/**
 * Read-only known-Out subset audit for wowy-r1.
 * Does not train, write to production tables, or change ingestion flags.
 *
 *   npx tsx scripts/audit-wowy-r1-known-out.ts
 */
import 'dotenv/config';

import { writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { classifyWowyAppearance } from '../lib/wowy/appearance';
import { classifyWowyGames } from '../lib/wowy/eligibility';
import { isUsableWowyPrior } from '../lib/wowy/cutoff';
import { rankTeammatesByPriorMinutes } from '../lib/wowy/candidate-features';
import {
  WOWY_R1_MIN_PRIMARY_PRIOR_MINUTES,
  WOWY_R1_MIN_PRIMARY_SHARED_GAMES,
} from '../lib/wowy/candidate-features';
import { wowySupportTier } from '../lib/wowy/policy';
import {
  intendedCutoffIso,
  selectKnownOutObservation,
  uniqueGameForTeamEtDate,
  WOWY_R1_OBS_FRESHNESS_MAX_HOURS,
  WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP,
  type TeamGameRef,
} from '../lib/wowy/known-out-association';
import type { PregameAvailabilityObservation } from '../lib/wowy/availability-gate';
import type { WowyLoadedGame, WowyPairQuery } from '../lib/wowy/types';
import type { WowyRosterAppearance } from '../lib/wowy/candidate-features';

const url = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');

const WINDOW_FROM = '2026-03-10T00:00:00.000Z';
const WINDOW_TO = '2026-05-07T00:00:00.000Z';
const SEASON = '2025';

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
  const exclusions: Record<string, number> = {
    subject_not_played: 0,
    incomplete_game: 0,
    no_primary_teammate: 0,
    ambiguous_team_et_date: 0,
    unique_game_mismatch: 0,
    no_observation_before_cutoff: 0,
    observation_on_or_after_cutoff: 0,
    observation_stale: 0,
    status_not_explicit_out: 0,
    missing_tip_or_cutoff: 0,
    insufficient_wowy_support: 0,
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

    const injRes = await pool.query<{
      player_id: string;
      team_id: string | null;
      status: string;
      snapshot_at: Date;
    }>(
      `SELECT player_id::text AS player_id,
              team_id::text AS team_id,
              status,
              snapshot_at
       FROM analytics.player_injury_status_history`
    );

    const observations: PregameAvailabilityObservation[] = injRes.rows.map((r) => ({
      playerId: r.player_id,
      teamId: r.team_id,
      status: r.status,
      snapshotAt: toIso(r.snapshot_at),
    }));

    const teamGames: TeamGameRef[] = [];
    const seenTeamGame = new Set<string>();
    for (const row of logsRes.rows) {
      const start = toIso(row.start_time);
      if (row.home_team_id) {
        const k = `${row.game_id}|${row.home_team_id}`;
        if (!seenTeamGame.has(k)) {
          seenTeamGame.add(k);
          teamGames.push({ gameId: row.game_id, teamId: row.home_team_id, startTime: start });
        }
      }
      if (row.away_team_id) {
        const k = `${row.game_id}|${row.away_team_id}`;
        if (!seenTeamGame.has(k)) {
          seenTeamGame.add(k);
          teamGames.push({ gameId: row.game_id, teamId: row.away_team_id, startTime: start });
        }
      }
    }

    const logsByPlayerTeam = new Map<string, LogRow[]>();
    const logByGamePlayer = new Map<string, LogRow>();
    const appearances: WowyRosterAppearance[] = [];
    for (const row of logsRes.rows) {
      const key = `${row.player_id}|${row.team_id}`;
      const list = logsByPlayerTeam.get(key) ?? [];
      list.push(row);
      logsByPlayerTeam.set(key, list);
      logByGamePlayer.set(`${row.game_id}|${row.player_id}`, row);
      appearances.push({
        playerId: row.player_id,
        gameId: row.game_id,
        startTime: toIso(row.start_time),
        teamId: row.team_id,
        minutes: row.minutes,
      });
    }

    const appearancesByTeam = new Map<string, WowyRosterAppearance[]>();
    for (const a of appearances) {
      const list = appearancesByTeam.get(a.teamId) ?? [];
      list.push(a);
      appearancesByTeam.set(a.teamId, list);
    }

    type PairCache = { classified: ReturnType<typeof classifyWowyGames> };
    const pairCache = new Map<string, PairCache>();

    function pairClassified(subjectId: string, teammateId: string, teamId: string): PairCache {
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
      const entry = { classified };
      pairCache.set(key, entry);
      return entry;
    }

    const windowFromMs = Date.parse(WINDOW_FROM);
    const windowToMs = Date.parse(WINDOW_TO);
    let candidatePlayed = 0;
    const eligible: Array<{
      playerId: string;
      teammateId: string;
      gameId: string;
      startTime: string;
      support: string;
    }> = [];

    const seenSubjectGame = new Set<string>();
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
        exclusions.subject_not_played += 1;
        continue;
      }
      if (row.status !== 'Final' || row.home_score == null || row.away_score == null) {
        exclusions.incomplete_game += 1;
        continue;
      }
      candidatePlayed += 1;

      const start = toIso(row.start_time);
      const cutoff = intendedCutoffIso(start);
      if (!cutoff) {
        exclusions.missing_tip_or_cutoff += 1;
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
        exclusions.no_primary_teammate += 1;
        continue;
      }

      const uniq = uniqueGameForTeamEtDate(teamGames, row.team_id, start);
      if ('ambiguous' in uniq && uniq.ambiguous) {
        exclusions.ambiguous_team_et_date += 1;
        continue;
      }
      if ('gameId' in uniq && uniq.gameId !== row.game_id) {
        exclusions.unique_game_mismatch += 1;
        continue;
      }
      if (!('gameId' in uniq)) {
        exclusions.ambiguous_team_et_date += 1;
        continue;
      }

      const obs = selectKnownOutObservation({
        teammatePlayerId: primary.playerId,
        teamId: row.team_id,
        cutoffStartTime: cutoff,
        observations,
      });
      if (!obs.eligible) {
        const reason = obs.reason ?? 'no_observation_before_cutoff';
        exclusions[reason] = (exclusions[reason] ?? 0) + 1;
        continue;
      }

      const { classified } = pairClassified(row.player_id, primary.playerId, row.team_id);
      let withN = 0;
      let withoutN = 0;
      for (const g of classified) {
        if (!g.startTime || !isUsableWowyPrior(g.startTime, cutoff)) continue;
        if (g.bucket === 'with') withN += 1;
        if (g.bucket === 'without') withoutN += 1;
      }
      const support = wowySupportTier(withN, withoutN);
      if (support === 'insufficient') {
        exclusions.insufficient_wowy_support += 1;
        continue;
      }

      eligible.push({
        playerId: row.player_id,
        teammateId: primary.playerId,
        gameId: row.game_id,
        startTime: start,
        support,
      });
    }

    eligible.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const uniqueDates = [...new Set(eligible.map((r) => r.startTime.slice(0, 10)))].sort();
    const dateCutIndex = Math.max(1, Math.floor(uniqueDates.length * 0.7));
    const trainDates = new Set(uniqueDates.slice(0, dateCutIndex));
    const chronoTrain = eligible.filter((r) => trainDates.has(r.startTime.slice(0, 10)));
    const chronoEval = eligible.filter((r) => !trainDates.has(r.startTime.slice(0, 10)));

    const dates = new Set(eligible.map((r) => r.startTime.slice(0, 10)));
    const players = new Set(eligible.map((r) => r.playerId));
    const pairs = new Set(eligible.map((r) => `${r.playerId}|${r.teammateId}`));
    const games = new Set(eligible.map((r) => r.gameId));
    const low = eligible.filter((r) => r.support === 'low_support').length;
    const adequate = eligible.filter((r) => r.support === 'adequate').length;

    const n = eligible.length;
    const distinctDates = dates.size;
    let feasibility: 'insufficient' | 'exploratory_known_out_only';
    let feasibilityNote: string;
    if (n < 200 || distinctDates < 15) {
      feasibility = 'insufficient';
      feasibilityNote =
        'Known-Out eligible n or date span is too small for chronological train/eval even as an exploratory subset.';
    } else {
      feasibility = 'exploratory_known_out_only';
      feasibilityNote =
        'Subset can support a chronological exploratory comparison with a matched no-WOWY ablation on explicitly known-Out rows only. It is not a three-season backtest, cannot certify WITH, remains development evidence (season 2025 already inspected), and is below the original 2,000-row 2024 nomination floor.';
    }

    const payload = {
      audited_at: new Date().toISOString(),
      season: SEASON,
      window: { from: WINDOW_FROM, to: WINDOW_TO, note: 'Season 2025 includes March–May 2026.' },
      cutoff_minutes_before_tip: WOWY_R1_PREDICTION_CUTOFF_MINUTES_BEFORE_TIP,
      freshness_max_hours: WOWY_R1_OBS_FRESHNESS_MAX_HOURS,
      join_rule:
        'Unique Final team-night on America/New_York date + injury team_id equals subject team_id. Missing game_id is a schema gap, not an impossible join. Collisions → exclude.',
      do_not_infer: ['Available from report omission', 'Out from missing PGL row', 'WITH from Probable'],
      candidate_played_subject_games: candidatePlayed,
      eligible_known_out: {
        n,
        distinct_game_dates: distinctDates,
        distinct_games: games.size,
        distinct_players: players.size,
        distinct_teammate_pairs: pairs.size,
        low_support: low,
        adequate_support: adequate,
        min_start: eligible[0]?.startTime ?? null,
        max_start: eligible[eligible.length - 1]?.startTime ?? null,
      },
      chrono_split_by_game_date: {
        rule: 'First 70% of distinct UTC date prefixes train; remaining dates eval. Same calendar date is not split.',
        train_n: chronoTrain.length,
        eval_n: chronoEval.length,
        train_dates: trainDates.size,
        eval_dates: uniqueDates.length - trainDates.size,
        train_min: chronoTrain[0]?.startTime ?? null,
        train_max: chronoTrain[chronoTrain.length - 1]?.startTime ?? null,
        eval_min: chronoEval[0]?.startTime ?? null,
        eval_max: chronoEval[chronoEval.length - 1]?.startTime ?? null,
      },
      exclusions,
      feasibility,
      feasibility_note: feasibilityNote,
      compared_to_315_of_322:
        '315/322 is team-games with some pre-tip Out on either roster. This audit is player-games whose primary prior-minutes teammate is explicitly Out before T−60 with unambiguous team-night join and WOWY support.',
    };

    const out = join('reports/modeling/wowy-r1/known-out-subset.json');
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(JSON.stringify({ wrote: out, n, feasibility, distinctDates, players: players.size, pairs: pairs.size }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
