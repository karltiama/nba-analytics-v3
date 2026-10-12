/**
 * Scoreboard persistence. Display schema only: display.scoreboard_games,
 * display.scoreboard_player_lines, display.scoreboard_collector_state,
 * display.scoreboard_game_odds, display.scoreboard_odds_state.
 * Prepared migrations: db/schemas/MIGRATION_display_scoreboard.sql,
 * db/schemas/MIGRATION_display_scoreboard_odds.sql (not applied).
 */

import type {
  ScoreboardPlayerLine,
  ScoreboardSeasonType,
  StoredOddsQuote,
  StoredScoreboardGame,
} from './contract';
import { oddsDue, SCOREBOARD_ODDS_POLICY, type OddsAttemptState } from './market';

export type OddsAcquisitionWrite = {
  quotes: StoredOddsQuote[];
  observedAt: string;
  requestId: string;
  /**
   * Games this acquisition fully covered (every page read). For these games, a current vendor row that
   * is missing from the acquisition is marked withdrawn. Empty when the acquisition was truncated.
   */
  withdrawGameIds: string[];
};

export type ScoreboardStore = {
  loadGames(seasonType: ScoreboardSeasonType, startDate: string, endDate: string): Promise<StoredScoreboardGame[]>;
  loadGamesForDate(etDate: string, seasonType?: ScoreboardSeasonType): Promise<StoredScoreboardGame[]>;
  /** One display.scoreboard_games row by provider game id, or null. */
  loadGameById(gameId: string): Promise<StoredScoreboardGame | null>;
  loadLastGamesRequestAt(seasonType: ScoreboardSeasonType): Promise<string | null>;
  recordGamesRequest(seasonType: ScoreboardSeasonType, at: string, requestId: string): Promise<void>;
  /** Writes each row only when its collection time is at least the stored one. Returns how many applied. */
  upsertGames(rows: StoredScoreboardGame[]): Promise<number>;
  /**
   * Writes the game and, when lines is non-null, replaces that game's player lines in one
   * transaction. A stale collection time writes nothing and returns false.
   */
  applyObservation(game: StoredScoreboardGame, lines: ScoreboardPlayerLine[] | null): Promise<boolean>;
  replacePlayerLines(gameId: string, lines: ScoreboardPlayerLine[]): Promise<void>;
  loadPlayerLines(gameIds: string[]): Promise<ScoreboardPlayerLine[]>;
  /**
   * Atomically claims the odds attempt slot when it is due (15 min after the last attempt, 5 min after a
   * failure). A concurrent or early invocation gets false and makes no odds request.
   */
  claimOddsAttempt(at: string): Promise<boolean>;
  recordOddsOutcome(
    at: string,
    outcome: { status: 'success'; requestId: string } | { status: 'failed'; error: string }
  ): Promise<void>;
  /**
   * Writes accepted current quotes and withdrawals in one transaction. A row is written only when its
   * collection time is at least the stored one and not older than a recorded withdrawal.
   */
  applyOddsAcquisition(input: OddsAcquisitionWrite): Promise<{ written: number; withdrawn: number }>;
  /** Current, non-withdrawn quotes for these games. */
  loadCurrentOdds(gameIds: string[]): Promise<StoredOddsQuote[]>;
};

const oddsKey = (q: Pick<StoredOddsQuote, 'gameId' | 'vendor' | 'quoteKind'>) => `${q.gameId}::${q.vendor}::${q.quoteKind}`;

type MemoryOddsState = NonNullable<OddsAttemptState> & {
  lastSuccessAt: string | null;
  lastSuccessRequestId: string | null;
  lastError: string | null;
};

export function createMemoryScoreboardStore(): ScoreboardStore & {
  games: Map<string, StoredScoreboardGame>;
  lines: Map<string, ScoreboardPlayerLine[]>;
  gamesRequests: Map<ScoreboardSeasonType, { at: string; requestId: string }>;
  odds: Map<string, StoredOddsQuote>;
  oddsState: { current: MemoryOddsState | null };
} {
  const games = new Map<string, StoredScoreboardGame>();
  const playerLines = new Map<string, ScoreboardPlayerLine[]>();
  const gamesRequests = new Map<ScoreboardSeasonType, { at: string; requestId: string }>();
  const odds = new Map<string, StoredOddsQuote>();
  const oddsState: { current: MemoryOddsState | null } = { current: null };
  return {
    games,
    lines: playerLines,
    gamesRequests,
    odds,
    oddsState,
    async claimOddsAttempt(at) {
      if (!oddsDue(oddsState.current, new Date(at))) return false;
      oddsState.current = {
        lastAttemptAt: at,
        lastOutcome: 'started',
        lastSuccessAt: oddsState.current?.lastSuccessAt ?? null,
        lastSuccessRequestId: oddsState.current?.lastSuccessRequestId ?? null,
        lastError: null,
      };
      return true;
    },
    async recordOddsOutcome(at, outcome) {
      const s = oddsState.current;
      if (!s || s.lastAttemptAt !== at) return;
      if (outcome.status === 'success') {
        oddsState.current = { ...s, lastOutcome: 'success', lastSuccessAt: at, lastSuccessRequestId: outcome.requestId, lastError: null };
      } else {
        oddsState.current = { ...s, lastOutcome: 'failed', lastError: outcome.error };
      }
    },
    async applyOddsAcquisition({ quotes, observedAt, requestId, withdrawGameIds }) {
      const at = Date.parse(observedAt);
      let written = 0;
      let withdrawn = 0;
      for (const q of quotes) {
        const key = oddsKey(q);
        const prev = odds.get(key);
        if (prev && Date.parse(prev.observedAt) > at) continue;
        if (prev?.withdrawnAt && Date.parse(prev.withdrawnAt) >= at) continue;
        odds.set(key, { ...q, firstObservedAt: prev?.firstObservedAt ?? q.firstObservedAt, withdrawnAt: null, withdrawnRequestId: null });
        written += 1;
      }
      const covered = new Set(withdrawGameIds);
      const present = new Set(quotes.map(oddsKey));
      for (const [key, q] of odds) {
        if (!covered.has(q.gameId) || q.quoteKind !== 'current' || present.has(key)) continue;
        if (q.withdrawnAt != null || Date.parse(q.observedAt) >= at) continue;
        odds.set(key, { ...q, withdrawnAt: observedAt, withdrawnRequestId: requestId });
        withdrawn += 1;
      }
      return { written, withdrawn };
    },
    async loadCurrentOdds(gameIds) {
      const ids = new Set(gameIds);
      return [...odds.values()]
        .filter((q) => ids.has(q.gameId) && q.quoteKind === 'current' && q.withdrawnAt == null)
        .map((q) => ({ ...q }));
    },
    async loadGames(seasonType, startDate, endDate) {
      return [...games.values()].filter(
        (g) => g.seasonType === seasonType && g.etDate >= startDate && g.etDate <= endDate
      );
    },
    async loadGamesForDate(etDate, seasonType) {
      return [...games.values()].filter((g) => g.etDate === etDate && (!seasonType || g.seasonType === seasonType));
    },
    async loadGameById(gameId) {
      return games.get(gameId) ?? null;
    },
    async loadLastGamesRequestAt(seasonType) {
      return gamesRequests.get(seasonType)?.at ?? null;
    },
    async recordGamesRequest(seasonType, at, requestId) {
      const prev = gamesRequests.get(seasonType);
      if (prev && Date.parse(prev.at) > Date.parse(at)) return;
      gamesRequests.set(seasonType, { at, requestId });
    },
    async upsertGames(rows) {
      let applied = 0;
      for (const r of rows) if (await this.applyObservation(r, null)) applied += 1;
      return applied;
    },
    async applyObservation(game, nextLines) {
      const prev = games.get(game.gameId);
      if (prev && Date.parse(prev.lastObservedAt) > Date.parse(game.lastObservedAt)) return false;
      games.set(game.gameId, { ...game });
      if (nextLines) playerLines.set(game.gameId, nextLines.map((l) => ({ ...l })));
      return true;
    },
    async replacePlayerLines(gameId, next) {
      playerLines.set(gameId, next.map((l) => ({ ...l })));
    },
    async loadPlayerLines(gameIds) {
      return gameIds.flatMap((id) => playerLines.get(id) ?? []);
    },
  };
}

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number | null };
type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };
type TxClient = Queryable & { release: () => void };

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

const LINE_FIELDS = {
  player_id: 'playerId',
  team_id: 'teamId',
  name: 'name',
  min: 'min',
  pts: 'pts',
  reb: 'reb',
  ast: 'ast',
  fgm: 'fgm',
  fga: 'fga',
  fg3m: 'fg3m',
  fg3a: 'fg3a',
  ftm: 'ftm',
  fta: 'fta',
  oreb: 'oreb',
  dreb: 'dreb',
} as const satisfies Record<string, Exclude<keyof ScoreboardPlayerLine, 'gameId'>>;
type LineColumn = keyof typeof LINE_FIELDS;
const LINE_COLUMNS = Object.keys(LINE_FIELDS) as LineColumn[];
const LINE_TYPES: Record<LineColumn, 'text' | 'int'> = {
  player_id: 'text',
  team_id: 'text',
  name: 'text',
  min: 'text',
  pts: 'int',
  reb: 'int',
  ast: 'int',
  fgm: 'int',
  fga: 'int',
  fg3m: 'int',
  fg3a: 'int',
  ftm: 'int',
  fta: 'int',
  oreb: 'int',
  dreb: 'int',
};

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

// Collection time, not commit time. An equal timestamp may complete the same observation
// (games row, then its player lines). An older timestamp does not write.
const UPSERT_GAME_SQL = `INSERT INTO display.scoreboard_games (${GAME_COLUMNS.map(([c]) => c).join(', ')}, updated_at)
  VALUES (${GAME_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}, now())
  ON CONFLICT (game_id) DO UPDATE SET ${GAME_COLUMNS.filter(([c]) => c !== 'game_id')
    .map(([c]) => `${c} = excluded.${c}`)
    .join(', ')}, updated_at = now()
  WHERE display.scoreboard_games.last_observed_at <= excluded.last_observed_at
  RETURNING game_id`;

async function withTransaction<T>(db: Queryable, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const connect = (db as { connect?: () => Promise<TxClient> }).connect;
  if (typeof connect !== 'function') return fn(db);
  const client = await connect.call(db);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the original error is the one to surface */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function replaceLines(q: Queryable, gameId: string, lines: ScoreboardPlayerLine[]): Promise<void> {
  if (lines.length > 0) {
    const col = <K extends keyof ScoreboardPlayerLine>(k: K) => lines.map((l) => l[k]);
    await q.query(
      `INSERT INTO display.scoreboard_player_lines (game_id, ${LINE_COLUMNS.join(', ')}, updated_at)
       SELECT $1, u.*, now() FROM unnest(${LINE_COLUMNS.map((c, i) => `$${i + 2}::${LINE_TYPES[c]}[]`).join(', ')}) AS u
       ON CONFLICT (game_id, player_id) DO UPDATE SET
         ${LINE_COLUMNS.filter((c) => c !== 'player_id').map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = now()`,
      [gameId, ...LINE_COLUMNS.map((c) => col(LINE_FIELDS[c]))]
    );
  }
  await q.query(
    `DELETE FROM display.scoreboard_player_lines WHERE game_id = $1 AND NOT (player_id = ANY($2::text[]))`,
    [gameId, lines.map((l) => l.playerId)]
  );
}

async function writeObservation(q: Queryable, game: StoredScoreboardGame, lines: ScoreboardPlayerLine[] | null): Promise<boolean> {
  const written = await q.query(
    UPSERT_GAME_SQL,
    GAME_COLUMNS.map(([, field]) => game[field])
  );
  if (written.rows.length === 0) return false;
  if (lines) await replaceLines(q, game.gameId, lines);
  return true;
}

const ODDS_COLUMNS = [
  ['game_id', 'gameId', 'text'],
  ['vendor', 'vendor', 'text'],
  ['quote_kind', 'quoteKind', 'text'],
  ['moneyline_home', 'moneylineHome', 'int'],
  ['moneyline_away', 'moneylineAway', 'int'],
  ['spread_home', 'spreadHome', 'numeric'],
  ['spread_home_odds', 'spreadHomeOdds', 'int'],
  ['spread_away', 'spreadAway', 'numeric'],
  ['spread_away_odds', 'spreadAwayOdds', 'int'],
  ['total', 'total', 'numeric'],
  ['total_over_odds', 'totalOverOdds', 'int'],
  ['total_under_odds', 'totalUnderOdds', 'int'],
  ['provider_updated_at', 'providerUpdatedAt', 'timestamptz'],
  ['vendor_synced_at', 'vendorSyncedAt', 'timestamptz'],
  ['opened_at', 'openedAt', 'timestamptz'],
  ['first_observed_at', 'firstObservedAt', 'timestamptz'],
  ['observed_at', 'observedAt', 'timestamptz'],
  ['request_id', 'requestId', 'text'],
  ['withdrawn_at', 'withdrawnAt', 'timestamptz'],
  ['withdrawn_request_id', 'withdrawnRequestId', 'text'],
] as const satisfies ReadonlyArray<readonly [string, keyof StoredOddsQuote, 'text' | 'int' | 'numeric' | 'timestamptz']>;

const ODDS_KEY_COLUMNS = new Set(['game_id', 'vendor', 'quote_kind']);
const ODDS_WRITE_COLUMNS = ODDS_COLUMNS.filter(([c]) => c !== 'withdrawn_at' && c !== 'withdrawn_request_id');

// Collection time guards every write: an older acquisition never replaces a newer row, and never
// revives a row a newer acquisition withdrew. Re-delivery of the same acquisition rewrites identical values.
const UPSERT_ODDS_SQL = `INSERT INTO display.scoreboard_game_odds (${ODDS_WRITE_COLUMNS.map(([c]) => c).join(', ')}, updated_at)
  SELECT u.*, now() FROM unnest(${ODDS_WRITE_COLUMNS.map(([, , t], i) => `$${i + 1}::${t}[]`).join(', ')}) AS u
  ON CONFLICT (game_id, vendor, quote_kind) DO UPDATE SET
    ${ODDS_WRITE_COLUMNS.filter(([c]) => !ODDS_KEY_COLUMNS.has(c) && c !== 'first_observed_at')
      .map(([c]) => `${c} = excluded.${c}`)
      .join(', ')},
    withdrawn_at = null, withdrawn_request_id = null, updated_at = now()
  WHERE display.scoreboard_game_odds.observed_at <= excluded.observed_at
    AND (display.scoreboard_game_odds.withdrawn_at IS NULL OR display.scoreboard_game_odds.withdrawn_at < excluded.observed_at)
  RETURNING game_id`;

function rowToOdds(r: Record<string, unknown>): StoredOddsQuote {
  const out: Record<string, unknown> = {};
  for (const [col, field, type] of ODDS_COLUMNS) {
    const v = r[col];
    if (v == null) out[field] = null;
    else if (type === 'timestamptz') out[field] = new Date(v as string | Date).toISOString();
    else if (type === 'numeric' || type === 'int') out[field] = Number(v);
    else out[field] = String(v);
  }
  return out as StoredOddsQuote;
}

export function createPgScoreboardStore(db: Queryable): ScoreboardStore {
  return {
    async claimOddsAttempt(at) {
      const res = await db.query(
        `INSERT INTO display.scoreboard_odds_state (scope, last_attempt_at, last_outcome, updated_at)
         VALUES ('current', $1, 'started', now())
         ON CONFLICT (scope) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at, last_outcome = 'started', last_error = null, updated_at = now()
         WHERE display.scoreboard_odds_state.last_attempt_at <= excluded.last_attempt_at - make_interval(secs =>
           CASE WHEN display.scoreboard_odds_state.last_outcome = 'failed' THEN $2::double precision ELSE $3::double precision END)
         RETURNING scope`,
        [at, SCOREBOARD_ODDS_POLICY.RETRY_AFTER_FAILURE_MS / 1000, SCOREBOARD_ODDS_POLICY.INTERVAL_MS / 1000]
      );
      return res.rows.length > 0;
    },
    async recordOddsOutcome(at, outcome) {
      if (outcome.status === 'success') {
        await db.query(
          `UPDATE display.scoreboard_odds_state SET last_outcome = 'success', last_success_at = $1,
             last_success_request_id = $2, last_error = null, updated_at = now()
           WHERE scope = 'current' AND last_attempt_at = $1`,
          [at, outcome.requestId]
        );
      } else {
        await db.query(
          `UPDATE display.scoreboard_odds_state SET last_outcome = 'failed', last_error = $2, updated_at = now()
           WHERE scope = 'current' AND last_attempt_at = $1`,
          [at, outcome.error.slice(0, 500)]
        );
      }
    },
    async applyOddsAcquisition({ quotes, observedAt, requestId, withdrawGameIds }) {
      return withTransaction(db, async (q) => {
        let written = 0;
        if (quotes.length > 0) {
          const res = await q.query(
            UPSERT_ODDS_SQL,
            ODDS_WRITE_COLUMNS.map(([, field]) => quotes.map((row) => row[field]))
          );
          written = res.rows.length;
        }
        let withdrawn = 0;
        if (withdrawGameIds.length > 0) {
          const res = await q.query(
            `UPDATE display.scoreboard_game_odds o
             SET withdrawn_at = $1, withdrawn_request_id = $2, updated_at = now()
             WHERE o.game_id = ANY($3::text[]) AND o.quote_kind = 'current' AND o.withdrawn_at IS NULL
               AND o.observed_at < $1
               AND NOT ((o.game_id || '::' || o.vendor) = ANY($4::text[]))
             RETURNING o.game_id`,
            [observedAt, requestId, withdrawGameIds, quotes.map((row) => `${row.gameId}::${row.vendor}`)]
          );
          withdrawn = res.rows.length;
        }
        return { written, withdrawn };
      });
    },
    async loadCurrentOdds(gameIds) {
      if (gameIds.length === 0) return [];
      const res = await db.query(
        `SELECT ${ODDS_COLUMNS.map(([c]) => c).join(', ')} FROM display.scoreboard_game_odds
         WHERE game_id = ANY($1::text[]) AND quote_kind = 'current' AND withdrawn_at IS NULL
         ORDER BY game_id, vendor`,
        [gameIds]
      );
      return res.rows.map(rowToOdds);
    },
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
    async loadGameById(gameId) {
      const res = await db.query(`${SELECT_GAMES} WHERE game_id = $1`, [gameId]);
      return res.rows[0] ? rowToGame(res.rows[0]) : null;
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
           updated_at = now()
         WHERE display.scoreboard_collector_state.last_games_request_at <= excluded.last_games_request_at`,
        [seasonType, at, requestId]
      );
    },
    async upsertGames(rows) {
      return withTransaction(db, async (q) => {
        let applied = 0;
        for (const row of rows) if (await writeObservation(q, row, null)) applied += 1;
        return applied;
      });
    },
    async applyObservation(game, lines) {
      return withTransaction(db, (q) => writeObservation(q, game, lines));
    },
    async replacePlayerLines(gameId, lines) {
      await replaceLines(db, gameId, lines);
    },
    async loadPlayerLines(gameIds) {
      if (gameIds.length === 0) return [];
      const res = await db.query(
        `SELECT game_id, ${LINE_COLUMNS.join(', ')}
         FROM display.scoreboard_player_lines WHERE game_id = ANY($1::text[]) ORDER BY game_id, team_id, pts DESC NULLS LAST`,
        [gameIds]
      );
      return res.rows.map((r) => {
        const line: Record<string, unknown> = { gameId: String(r.game_id) };
        for (const c of LINE_COLUMNS) {
          const v = r[c];
          line[LINE_FIELDS[c]] = LINE_TYPES[c] === 'text' ? (v == null ? null : String(v)) : ((v as number | null) ?? null);
        }
        return line as ScoreboardPlayerLine;
      });
    },
  };
}
