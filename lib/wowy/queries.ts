import { query, queryOne } from '@/lib/db';
import { WOWY_POSTSEASON_START_ET } from './calendar';
import { classifyWowyGames } from './eligibility';
import { summarizeWowyPair } from './aggregate';
import { summarizeWowyBeforeCutoff } from './model-adapter';
import type {
  WowyLoadedGame,
  WowyModelPairResult,
  WowyPairQuery,
  WowyPairSummary,
  WowyPlayerIdentity,
  WowyScenarioSelection,
  WowySeasonType,
  WowyTeamStintOption,
  WowyTeammateOption,
} from './types';

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function toDateText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function resolveWowyPlayerIdentity(playerId: string): Promise<WowyPlayerIdentity | null> {
  const row = await queryOne<{
    player_id: string;
    full_name: string;
    position: string | null;
    player_entity_id: string | null;
    nba_player_id: string | null;
  }>(
    `SELECT p.player_id::text AS player_id,
            p.full_name,
            p.position,
            p.player_entity_id::text AS player_entity_id,
            nba.provider_player_id::text AS nba_player_id
     FROM analytics.players p
     LEFT JOIN analytics.player_provider_ids nba
       ON nba.player_entity_id = p.player_entity_id AND nba.provider = 'nba'
     WHERE p.player_id = $1`,
    [playerId]
  );
  if (!row) return null;

  const quarantine = await queryOne<{ status: string }>(
    `SELECT status
     FROM analytics.player_identity_unresolved
     WHERE provider = 'balldontlie'
       AND provider_player_id = $1
       AND status IN ('UNRESOLVED', 'CONFLICT')
     LIMIT 1`,
    [playerId]
  );

  let identityOk = true;
  let identityReason: string | null = null;
  if (!row.player_entity_id) {
    identityOk = false;
    identityReason = 'analytics.players.player_entity_id is null';
  } else if (quarantine) {
    identityOk = false;
    identityReason = `player_identity_unresolved.status=${quarantine.status}`;
  }

  return {
    playerId: row.player_id,
    fullName: row.full_name,
    position: row.position,
    playerEntityId: row.player_entity_id,
    nbaPlayerId: row.nba_player_id,
    identityOk,
    identityReason,
  };
}

export async function searchWowyPlayers(q: string, limit = 15): Promise<WowyPlayerIdentity[]> {
  const needle = q.trim().replace(/[%_]/g, '');
  if (needle.length < 2) return [];
  const rows = await query<{
    player_id: string;
    full_name: string;
    position: string | null;
    player_entity_id: string | null;
    nba_player_id: string | null;
  }>(
    `SELECT p.player_id::text AS player_id,
            p.full_name,
            p.position,
            p.player_entity_id::text AS player_entity_id,
            nba.provider_player_id::text AS nba_player_id
     FROM analytics.players p
     LEFT JOIN analytics.player_provider_ids nba
       ON nba.player_entity_id = p.player_entity_id AND nba.provider = 'nba'
     WHERE p.player_entity_id IS NOT NULL
       AND p.full_name ILIKE '%' || $1 || '%'
     ORDER BY p.full_name
     LIMIT $2`,
    [needle, Math.min(Math.max(limit, 1), 30)]
  );
  return rows.map((row) => ({
    playerId: row.player_id,
    fullName: row.full_name,
    position: row.position,
    playerEntityId: row.player_entity_id,
    nbaPlayerId: row.nba_player_id,
    identityOk: true,
    identityReason: null,
  }));
}

/**
 * Team options from game-log team_id on Final games.
 * first/last dates are box-score coverage bounds, not verified trade dates.
 */
export async function loadWowyTeamStints(playerId: string, season: string): Promise<WowyTeamStintOption[]> {
  const rows = await query<{
    team_id: string;
    abbreviation: string;
    full_name: string;
    first_d: string | null;
    last_d: string | null;
    n: string | number;
  }>(
    `SELECT l.team_id::text AS team_id,
            t.abbreviation,
            t.full_name,
            min(l.game_date)::text AS first_d,
            max(l.game_date)::text AS last_d,
            count(*)::int AS n
     FROM analytics.player_game_logs l
     JOIN analytics.games g ON g.game_id = l.game_id
     JOIN analytics.teams t ON t.team_id = l.team_id
     WHERE l.player_id = $1
       AND l.season = $2
       AND g.status = 'Final'
     GROUP BY l.team_id, t.abbreviation, t.full_name
     ORDER BY min(l.game_date) NULLS LAST`,
    [playerId, season]
  );
  return rows.map((row) => ({
    teamId: row.team_id,
    abbreviation: row.abbreviation,
    fullName: row.full_name,
    firstGameDate: toDateText(row.first_d),
    lastGameDate: toDateText(row.last_d),
    gameCount: Number(row.n),
    verifiedTradeDates: false,
    evidence: 'game_log_team_id',
  }));
}

/**
 * Game-level played token, matching classifyWowyAppearance for numeric logs:
 * "00" is never played; "0"/"0.0" and minutes > 0 are played.
 */
const PGL_PLAYED_SQL = (alias: string) =>
  `${alias}.minutes ~ '^[0-9]+(\\.[0-9]+)?$'
   AND ${alias}.minutes IS DISTINCT FROM '00'
   AND (NULLIF(${alias}.minutes, '')::numeric > 0 OR ${alias}.minutes IN ('0', '0.0'))`;

export async function loadWowyTeammates(args: {
  subjectPlayerId: string;
  season: string;
  teamId: string;
  seasonType: WowySeasonType | 'all';
}): Promise<WowyTeammateOption[]> {
  const postseasonStart = WOWY_POSTSEASON_START_ET[args.season] ?? null;
  const rows = await query<{
    player_id: string;
    full_name: string;
    position: string | null;
    nba_player_id: string | null;
    shared: string | number;
    together: string | number;
    dnp: string | number;
  }>(
    `SELECT b.player_id::text AS player_id,
            p.full_name,
            p.position,
            nba.provider_player_id::text AS nba_player_id,
            count(*)::int AS shared,
            count(*) FILTER (
              WHERE ${PGL_PLAYED_SQL('a')}
                AND ${PGL_PLAYED_SQL('b')}
            )::int AS together,
            count(*) FILTER (
              WHERE ${PGL_PLAYED_SQL('a')}
                AND b.minutes = '00'
            )::int AS dnp
     FROM analytics.player_game_logs a
     JOIN analytics.games g ON g.game_id = a.game_id
     JOIN analytics.player_game_logs b
       ON b.game_id = a.game_id
      AND b.team_id = a.team_id
      AND b.player_id <> a.player_id
     JOIN analytics.players p ON p.player_id = b.player_id
     LEFT JOIN analytics.player_provider_ids nba
       ON nba.player_entity_id = p.player_entity_id AND nba.provider = 'nba'
     WHERE a.player_id = $1
       AND a.season = $2
       AND a.team_id = $3
       AND g.status = 'Final'
       AND g.start_time IS NOT NULL
       AND g.home_score IS NOT NULL
       AND g.away_score IS NOT NULL
       AND p.player_entity_id IS NOT NULL
       AND (
         $4::text = 'all'
         OR (
           $4::text = 'regular'
           AND (
             $5::date IS NULL
             OR (g.start_time AT TIME ZONE 'America/New_York')::date < $5::date
           )
         )
         OR (
           $4::text = 'playoffs'
           AND $5::date IS NOT NULL
           AND (g.start_time AT TIME ZONE 'America/New_York')::date >= $5::date
         )
       )
     GROUP BY b.player_id, p.full_name, p.position, nba.provider_player_id
     ORDER BY count(*) FILTER (
              WHERE ${PGL_PLAYED_SQL('a')}
                AND ${PGL_PLAYED_SQL('b')}
            ) DESC, p.full_name
     LIMIT 80`,
    [args.subjectPlayerId, args.season, args.teamId, args.seasonType, postseasonStart]
  );
  return rows.map((row) => ({
    playerId: row.player_id,
    fullName: row.full_name,
    position: row.position,
    nbaPlayerId: row.nba_player_id,
    sharedRosterGames: Number(row.shared),
    togetherPlayedGames: Number(row.together),
    verifiedDnpGames: Number(row.dnp),
  }));
}

export async function loadWowyPairGames(pairQuery: WowyPairQuery): Promise<WowyLoadedGame[]> {
  const rows = await query<{
    game_id: string;
    start_time: Date | string | null;
    game_date: string | null;
    season: string;
    status: string | null;
    home_score: number | null;
    away_score: number | null;
    subject_team_id: string;
    opponent_team_id: string | null;
    opponent_abbr: string | null;
    home_team_id: string | null;
    subject_minutes: string | null;
    subject_pts: number | null;
    subject_reb: number | null;
    subject_ast: number | null;
    subject_tpm: number | null;
    subject_fga: number | null;
    subject_tpa: number | null;
    subject_fta: number | null;
    teammate_row_present: boolean;
    teammate_team_id: string | null;
    teammate_minutes: string | null;
    teammate_pts: number | null;
    teammate_reb: number | null;
    teammate_ast: number | null;
    teammate_tpm: number | null;
    teammate_fga: number | null;
    teammate_fta: number | null;
    team_pts: number | null;
    team_reb: number | null;
    team_ast: number | null;
    team_tpm: number | null;
    team_fga: number | null;
    team_tpa: number | null;
    team_fta: number | null;
    team_opp_pts: number | null;
  }>(
    `SELECT g.game_id::text AS game_id,
            g.start_time,
            l.game_date::text AS game_date,
            l.season,
            g.status,
            g.home_score,
            g.away_score,
            l.team_id::text AS subject_team_id,
            l.opponent_team_id::text AS opponent_team_id,
            opp.abbreviation AS opponent_abbr,
            g.home_team_id::text AS home_team_id,
            l.minutes AS subject_minutes,
            l.points AS subject_pts,
            l.rebounds AS subject_reb,
            l.assists AS subject_ast,
            l.three_pointers_made AS subject_tpm,
            l.field_goals_attempted AS subject_fga,
            l.three_pointers_attempted AS subject_tpa,
            l.free_throws_attempted AS subject_fta,
            (t.player_id IS NOT NULL) AS teammate_row_present,
            t.team_id::text AS teammate_team_id,
            t.minutes AS teammate_minutes,
            t.points AS teammate_pts,
            t.rebounds AS teammate_reb,
            t.assists AS teammate_ast,
            t.three_pointers_made AS teammate_tpm,
            t.field_goals_attempted AS teammate_fga,
            t.free_throws_attempted AS teammate_fta,
            tgs.team_points AS team_pts,
            tgs.team_rebounds AS team_reb,
            tgs.team_assists AS team_ast,
            tgs.team_3pm AS team_tpm,
            tgs.team_fga AS team_fga,
            tgs.team_3pa AS team_tpa,
            tgs.team_fta AS team_fta,
            tgs.points_allowed AS team_opp_pts
     FROM analytics.player_game_logs l
     JOIN analytics.games g ON g.game_id = l.game_id
     LEFT JOIN analytics.teams opp ON opp.team_id = l.opponent_team_id
     LEFT JOIN analytics.player_game_logs t
       ON t.game_id = l.game_id AND $2 <> '' AND t.player_id = $2
     LEFT JOIN analytics.team_game_stats tgs
       ON tgs.game_id = l.game_id AND tgs.team_id = l.team_id
     WHERE l.player_id = $1
       AND l.season = $3
       AND l.team_id = $4
     ORDER BY g.start_time ASC NULLS LAST, l.game_date ASC NULLS LAST`,
     [pairQuery.subjectPlayerId, pairQuery.teammatePlayerId ?? '', pairQuery.season, pairQuery.teamId]
  );

  return rows.map((row) => ({
    gameId: row.game_id,
    startTime: toIso(row.start_time),
    gameDate: toDateText(row.game_date),
      season: String(row.season ?? pairQuery.season),
    status: row.status,
    homeScore: toNum(row.home_score),
    awayScore: toNum(row.away_score),
    subjectTeamId: row.subject_team_id,
    homeTeamId: row.home_team_id,
    opponentTeamId: row.opponent_team_id,
    opponentAbbr: row.opponent_abbr,
    subjectMinutes: row.subject_minutes,
    subjectPts: toNum(row.subject_pts),
    subjectReb: toNum(row.subject_reb),
    subjectAst: toNum(row.subject_ast),
    subjectTpm: toNum(row.subject_tpm),
    subjectFga: toNum(row.subject_fga),
    subjectTpa: toNum(row.subject_tpa),
    subjectFta: toNum(row.subject_fta),
    teammateRowPresent: Boolean(row.teammate_row_present),
    teammateTeamId: row.teammate_team_id,
    teammateMinutes: row.teammate_minutes,
    teammatePts: toNum(row.teammate_pts),
    teammateReb: toNum(row.teammate_reb),
    teammateAst: toNum(row.teammate_ast),
    teammateTpm: toNum(row.teammate_tpm),
    teammateFga: toNum(row.teammate_fga),
    teammateFta: toNum(row.teammate_fta),
    teamPts: toNum(row.team_pts),
    teamReb: toNum(row.team_reb),
    teamAst: toNum(row.team_ast),
    teamTpm: toNum(row.team_tpm),
    teamFga: toNum(row.team_fga),
    teamTpa: toNum(row.team_tpa),
    teamFta: toNum(row.team_fta),
    teamOppPts: toNum(row.team_opp_pts),
  }));
}

export async function loadWowyPairSummary(query: WowyPairQuery): Promise<
  | { ok: true; summary: WowyPairSummary }
  | { ok: false; error: string; code: 'not_found' | 'ambiguous_identity' | 'same_player' }
> {
  if (query.teammatePlayerId && query.subjectPlayerId === query.teammatePlayerId) {
    return { ok: false, error: 'Subject and teammate must be different players.', code: 'same_player' };
  }
  const [subject, teammate, team] = await Promise.all([
    resolveWowyPlayerIdentity(query.subjectPlayerId),
    query.teammatePlayerId ? resolveWowyPlayerIdentity(query.teammatePlayerId) : Promise.resolve(null),
    queryOne<{ abbreviation: string; full_name: string }>(
      `SELECT abbreviation, full_name FROM analytics.teams WHERE team_id = $1`,
      [query.teamId]
    ),
  ]);
  if (!subject || (query.teammatePlayerId && !teammate)) {
    return { ok: false, error: 'Player not found in analytics.players.', code: 'not_found' };
  }
  if (!subject.identityOk || (teammate && !teammate.identityOk)) {
    return {
      ok: false,
      error: `Ambiguous identity: ${subject.identityReason ?? teammate?.identityReason ?? 'unresolved'}`,
      code: 'ambiguous_identity',
    };
  }

  const games = await loadWowyPairGames(query);
  const classified = classifyWowyGames(games, query, { identityOk: true });
  return {
    ok: true,
    summary: summarizeWowyPair({
      query,
      classified,
      subjectName: subject.fullName,
      teammateName: teammate?.fullName ?? null,
      teamAbbreviation: team?.abbreviation,
      teamFullName: team?.full_name,
    }),
  };
}

export async function loadWowyModelPair(args: {
  query: WowyPairQuery;
  scenario?: WowyScenarioSelection;
}): Promise<
  | { ok: true; result: WowyModelPairResult }
  | { ok: false; error: string; code: 'not_found' | 'ambiguous_identity' | 'same_player' | 'missing_cutoff' }
> {
  if (!args.query.cutoffStartTime) {
    return { ok: false, error: 'cutoffStartTime is required for the model adapter.', code: 'missing_cutoff' };
  }
  const loaded = await loadWowyPairSummary(args.query);
  if (!loaded.ok) return loaded;
  const games = await loadWowyPairGames(args.query);
  return {
    ok: true,
    result: summarizeWowyBeforeCutoff({
      games,
      query: args.query,
      subjectName: loaded.summary.subject.fullName,
      teammateName: loaded.summary.teammate?.fullName ?? loaded.summary.subject.fullName,
      identityOk: true,
      scenario: args.scenario,
    }),
  };
}
