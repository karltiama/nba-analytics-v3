/**
 * Scoreboard persistence. Display schema only: display.scoreboard_games,
 * display.scoreboard_player_lines, display.scoreboard_collector_state.
 * Prepared migration: db/schemas/MIGRATION_display_scoreboard.sql (not applied).
 */

import type {
  ScoreboardPlayerLine,
  ScoreboardSeasonType,
  StoredScoreboardGame,
} from './contract';

export type ScoreboardStore = {
  loadGames(seasonType: ScoreboardSeasonType, startDate: string, endDate: string): Promise<StoredScoreboardGame[]>;
  loadGamesForDate(etDate: string, seasonType?: ScoreboardSeasonType): Promise<StoredScoreboardGame[]>;
  loadLastGamesRequestAt(seasonType: ScoreboardSeasonType): Promise<string | null>;
  recordGamesRequest(seasonType: ScoreboardSeasonType, at: string, requestId: string): Promise<void>;
  upsertGames(rows: StoredScoreboardGame[]): Promise<void>;
  replacePlayerLines(gameId: string, lines: ScoreboardPlayerLine[]): Promise<void>;
  loadPlayerLines(gameIds: string[]): Promise<ScoreboardPlayerLine[]>;
};

export function createMemoryScoreboardStore(): ScoreboardStore & {
  games: Map<string, StoredScoreboardGame>;
  lines: Map<string, ScoreboardPlayerLine[]>;
  gamesRequests: Map<ScoreboardSeasonType, { at: string; requestId: string }>;
} {
  const games = new Map<string, StoredScoreboardGame>();
  const lines = new Map<string, ScoreboardPlayerLine[]>();
  const gamesRequests = new Map<ScoreboardSeasonType, { at: string; requestId: string }>();
  return {
    games,
    lines,
    gamesRequests,
    async loadGames(seasonType, startDate, endDate) {
      return [...games.values()].filter(
        (g) => g.seasonType === seasonType && g.etDate >= startDate && g.etDate <= endDate
      );
    },
    async loadGamesForDate(etDate, seasonType) {
      return [...games.values()].filter((g) => g.etDate === etDate && (!seasonType || g.seasonType === seasonType));
    },
    async loadLastGamesRequestAt(seasonType) {
      return gamesRequests.get(seasonType)?.at ?? null;
    },
    async recordGamesRequest(seasonType, at, requestId) {
      gamesRequests.set(seasonType, { at, requestId });
    },
    async upsertGames(rows) {
      for (const r of rows) games.set(r.gameId, { ...r });
    },
    async replacePlayerLines(gameId, next) {
      lines.set(gameId, next.map((l) => ({ ...l })));
    },
    async loadPlayerLines(gameIds) {
      return gameIds.flatMap((id) => lines.get(id) ?? []);
    },
  };
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const GAME_COLUMNS = [
  ['game_id', 'gameId'],
  ['season', 'season'],
  ['season_type', 'seasonType'],
  ['season_type_source', 'seasonTypeSource'],
  ['et_date', 'etDate'],
  ['scheduled_tip', 'scheduledTip'],
  ['home_team_id', 'homeTeamId'],
  ['home_abbr', 'homeAbbr'],
  ['home_name', 'homeName'],
  ['home_score', 'homeScore'],
  ['visitor_team_id', 'visitorTeamId'],
  ['visitor_abbr', 'visitorAbbr'],
  ['visitor_name', 'visitorName'],
  ['visitor_score', 'visitorScore'],
  ['provider_status', 'providerStatus'],
  ['provider_status_state', 'providerStatusState'],
  ['period', 'period'],
  ['clock', 'clock'],
  ['overtime_periods', 'overtimePeriods'],
  ['lifecycle', 'lifecycle'],
  ['games_request_id', 'gamesRequestId'],
  ['first_observed_at', 'firstObservedAt'],
  ['last_observed_at', 'lastObservedAt'],
  ['last_changed_at', 'lastChangedAt'],
  ['terminal_confirmations', 'terminalConfirmations'],
  ['final_observed_at', 'finalObservedAt'],
  ['polling_state', 'pollingState'],
  ['box_completeness', 'boxCompleteness'],
  ['box_request_id', 'boxRequestId'],
  ['box_observed_at', 'boxObservedAt'],
  ['final_box_attempts', 'finalBoxAttempts'],
] as const satisfies ReadonlyArray<readonly [string, keyof StoredScoreboardGame]>;

const TIMESTAMP_FIELDS = new Set<string>([
  'scheduledTip',
  'firstObservedAt',
  'lastObservedAt',
  'lastChangedAt',
  'finalObservedAt',
  'boxObservedAt',
]);

function rowToGame(r: Record<string, unknown>): StoredScoreboardGame {
  const out: Record<string, unknown> = {};
  for (const [col, field] of GAME_COLUMNS) {
    const v = r[col];
    if (v instanceof Date) out[field] = field === 'etDate' ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (v != null && TIMESTAMP_FIELDS.has(field)) out[field] = new Date(String(v)).toISOString();
    else out[field] = v ?? null;
  }
  return out as StoredScoreboardGame;
}

const SELECT_GAMES = `SELECT ${GAME_COLUMNS.map(([c]) => (c === 'et_date' ? 'et_date::text AS et_date' : c)).join(', ')}
  FROM display.scoreboard_games`;

const UPSERT_GAME_SQL = `INSERT INTO display.scoreboard_games (${GAME_COLUMNS.map(([c]) => c).join(', ')}, updated_at)
  VALUES (${GAME_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}, now())
  ON CONFLICT (game_id) DO UPDATE SET ${GAME_COLUMNS.filter(([c]) => c !== 'game_id')
    .map(([c]) => `${c} = excluded.${c}`)
    .join(', ')}, updated_at = now()`;

export function createPgScoreboardStore(db: Queryable): ScoreboardStore {
  return {
    async loadGames(seasonType, startDate, endDate) {
      const res = await db.query(`${SELECT_GAMES} WHERE season_type = $1 AND et_date BETWEEN $2::date AND $3::date`, [
        seasonType,
        startDate,
        endDate,
      ]);
      return res.rows.map(rowToGame);
    },
    async loadGamesForDate(etDate, seasonType) {
      const res = seasonType
        ? await db.query(`${SELECT_GAMES} WHERE et_date = $1::date AND season_type = $2 ORDER BY scheduled_tip, game_id`, [
            etDate,
            seasonType,
          ])
        : await db.query(`${SELECT_GAMES} WHERE et_date = $1::date ORDER BY scheduled_tip, game_id`, [etDate]);
      return res.rows.map(rowToGame);
    },
    async loadLastGamesRequestAt(seasonType) {
      const res = await db.query(
        `SELECT last_games_request_at FROM display.scoreboard_collector_state WHERE season_type = $1`,
        [seasonType]
      );
      const v = res.rows[0]?.last_games_request_at;
      return v == null ? null : new Date(v as string | Date).toISOString();
    },
    async recordGamesRequest(seasonType, at, requestId) {
      await db.query(
        `INSERT INTO display.scoreboard_collector_state (season_type, last_games_request_at, last_games_request_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (season_type) DO UPDATE SET
           last_games_request_at = excluded.last_games_request_at,
           last_games_request_id = excluded.last_games_request_id,
           updated_at = now()`,
        [seasonType, at, requestId]
      );
    },
    async upsertGames(rows) {
      for (const r of rows) {
        await db.query(
          UPSERT_GAME_SQL,
          GAME_COLUMNS.map(([, field]) => r[field])
        );
      }
    },
    async replacePlayerLines(gameId, lines) {
      await db.query(`DELETE FROM display.scoreboard_player_lines WHERE game_id = $1`, [gameId]);
      for (const l of lines) {
        await db.query(
          `INSERT INTO display.scoreboard_player_lines (game_id, player_id, team_id, name, min, pts, reb, ast)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [l.gameId, l.playerId, l.teamId, l.name, l.min, l.pts, l.reb, l.ast]
        );
      }
    },
    async loadPlayerLines(gameIds) {
      if (gameIds.length === 0) return [];
      const res = await db.query(
        `SELECT game_id, player_id, team_id, name, min, pts, reb, ast
         FROM display.scoreboard_player_lines WHERE game_id = ANY($1::text[]) ORDER BY game_id, team_id, pts DESC NULLS LAST`,
        [gameIds]
      );
      return res.rows.map((r) => ({
        gameId: String(r.game_id),
        playerId: String(r.player_id),
        teamId: String(r.team_id),
        name: (r.name as string | null) ?? null,
        min: (r.min as string | null) ?? null,
        pts: (r.pts as number | null) ?? null,
        reb: (r.reb as number | null) ?? null,
        ast: (r.ast as number | null) ?? null,
      }));
    },
  };
}
