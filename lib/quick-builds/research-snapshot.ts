/**
 * Read-only mapper from the latest complete pregame pull into QuickBuildRequest.
 * research_snapshot only. Does not read analytics.player_props_current, and does
 * not treat an observation timestamp as a live sportsbook quote.
 */

import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { XRAY_CANONICAL_MARKETS } from '@/lib/parlay-xray/resolution/types';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { compareAttempts, isCompleteSuccess } from './eligibility';
import { attachQuickBuildDisplay, QUICK_BUILD_PLAYERS_SQL, type PlayerNameRow, type QuickBuildDisplayed } from './display';
import { generateQuickBuilds } from './index';
import {
  QUICK_BUILD_FIVE_LEG_PRESETS,
  QUICK_BUILD_FIVE_LEG_PRICE_NOTICE,
  QUICK_BUILD_FOUR_LEG_PRESETS,
  QUICK_BUILD_FOUR_LEG_PRICE_NOTICE,
  QUICK_BUILD_MAX_ATTEMPTS,
  QUICK_BUILD_MAX_GAMES,
  QUICK_BUILD_MAX_OBSERVATIONS,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_PRICE_NOTICE,
  QUICK_BUILD_SEARCH_BUDGET_NOTE,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QUICK_BUILD_THREE_LEG_PRICE_NOTICE,
  QuickBuildInputError,
  type GamePullAttempt,
  type MarketObservationInput,
  type QuickBuildFiveLegPresetName,
  type QuickBuildFourLegPresetName,
  type QuickBuildGameInput,
  type QuickBuildPresetName,
  type QuickBuildRequest,
  type QuickBuildResult,
  type QuickBuildThreeLegPresetName,
} from './types';

export const QUICK_BUILD_RESEARCH_LIMITATION =
  'Research snapshot of the latest complete pregame pull on today\'s unstarted slate. It is not a current sportsbook quote.';

const QUICK_BUILD_GAMES_WHERE = `
 WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
   AND g.start_time <  (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
   AND g.start_time > $2::timestamptz
`;

export const QUICK_BUILD_GAMES_SQL = `
SELECT g.game_id, g.start_time, g.status
  FROM analytics.games g
${QUICK_BUILD_GAMES_WHERE}
`;

/** Matchup labels for the selector. Not part of the observation read. */
export const QUICK_BUILD_SLATE_SQL = `
SELECT g.game_id,
       g.start_time,
       g.status,
       ht.abbreviation AS home_abbr,
       at.abbreviation AS away_abbr
  FROM analytics.games g
  LEFT JOIN analytics.teams ht ON ht.team_id = g.home_team_id
  LEFT JOIN analytics.teams at ON at.team_id = g.away_team_id
${QUICK_BUILD_GAMES_WHERE}
`;

export const QUICK_BUILD_ATTEMPTS_SQL = `
SELECT pull_run_id::text AS pull_run_id,
       game_id,
       status,
       rows_stored,
       completed_at,
       started_at
  FROM raw.player_prop_game_runs
 WHERE game_id = ANY($1::text[])
`;

export const QUICK_BUILD_CLOCK_SQL = `
SELECT s.pull_run_id::text AS pull_run_id,
       s.game_id::text AS game_id,
       COUNT(*)::int AS snapshot_rows,
       COUNT(*) FILTER (
         WHERE s.observation_clock = 'RESPONSE_RECEIVED' AND s.observed_at IS NOT NULL
       )::int AS response_rows
  FROM raw.player_prop_snapshots_v2 s
  INNER JOIN (
    SELECT * FROM unnest($1::bigint[], $2::integer[]) AS keys(pull_run_id, game_id)
  ) k ON s.pull_run_id = k.pull_run_id AND s.game_id = k.game_id
 GROUP BY s.pull_run_id, s.game_id
`;

const OBSERVATION_FROM = `
  FROM raw.player_prop_snapshots_v2 s
  INNER JOIN (
    SELECT * FROM unnest($1::bigint[], $2::integer[]) AS keys(pull_run_id, game_id)
  ) k ON s.pull_run_id = k.pull_run_id AND s.game_id = k.game_id
 WHERE lower(trim(s.sportsbook)) = $3
   AND lower(coalesce(s.market_type, '')) = 'over_under'
   AND lower(coalesce(s.side, '')) IN ('over', 'under')
   AND lower(coalesce(s.prop_type, '')) = ANY($4::text[])
`;

export const QUICK_BUILD_OBSERVATION_COUNT_SQL = `
SELECT COUNT(*)::int AS observation_count
${OBSERVATION_FROM}
`;

export const QUICK_BUILD_OBSERVATION_ROWS_SQL = `
SELECT s.player_id::text AS player_id,
       s.game_id::text AS game_id,
       s.prop_type,
       lower(s.side) AS side,
       s.line_value::text AS line_value,
       s.sportsbook,
       s.odds_american,
       s.pull_run_id::text AS pull_run_id,
       s.observed_at,
       s.observation_clock
${OBSERVATION_FROM}
`;

export const QUICK_BUILD_READ_SQL = [
  QUICK_BUILD_GAMES_SQL,
  QUICK_BUILD_ATTEMPTS_SQL,
  QUICK_BUILD_CLOCK_SQL,
  QUICK_BUILD_OBSERVATION_COUNT_SQL,
  QUICK_BUILD_OBSERVATION_ROWS_SQL,
  QUICK_BUILD_PLAYERS_SQL,
] as const;

const INT4_MAX = 2147483647;
const CANONICAL_MARKETS = [...XRAY_CANONICAL_MARKETS];

export type QuickBuildReader = (sql: string, params?: unknown[]) => Promise<readonly unknown[]>;

export type QuickBuildApiBody = Omit<QuickBuildResult, 'builds'> & {
  generatedAt: string;
  preset: ResearchPresetName;
  snapshotClass: 'research_snapshot';
  limitations: readonly string[];
  builds: QuickBuildDisplayed[];
};

type GameRow = {
  game_id: unknown;
  start_time: unknown;
  status: unknown;
  home_abbr?: unknown;
  away_abbr?: unknown;
};

export type ResearchSlateGame = {
  gameId: string;
  startTime: string;
  awayAbbreviation: string | null;
  homeAbbreviation: string | null;
  /** Verified "AWY @ HOM" label. Null when either abbreviation is missing. */
  label: string | null;
};

export type SelectedGameIdParse =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      status: 400 | 422;
      code: 'INVALID_GAME_SELECTION' | 'NEED_TWO_GAMES' | 'NEED_THREE_GAMES' | 'NEED_FOUR_GAMES' | 'NEED_FIVE_GAMES' | 'LIMIT_EXCEEDED';
    };

type AttemptRow = {
  pull_run_id: unknown;
  game_id: unknown;
  status: unknown;
  rows_stored: unknown;
  completed_at: unknown;
  started_at: unknown;
};

type ClockRow = {
  pull_run_id: unknown;
  game_id: unknown;
  snapshot_rows: unknown;
  response_rows: unknown;
};

type ObservationRow = {
  player_id: unknown;
  game_id: unknown;
  prop_type: unknown;
  side: unknown;
  line_value: unknown;
  sportsbook: unknown;
  odds_american: unknown;
  pull_run_id: unknown;
  observed_at: unknown;
  observation_clock: unknown;
};

function etDateKey(instant: Date): string {
  return instant.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function instantIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function requireRows(rows: unknown, label: string): unknown[] {
  if (!Array.isArray(rows)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', `${label} did not return rows`);
  }
  return rows;
}

function asId(value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new QuickBuildInputError('MALFORMED_INPUT', `${label} is missing`);
}

function asInt4(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > INT4_MAX) return null;
  return n;
}

function asBigint(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'snapshot count is invalid');
  }
  return n;
}

function cleanAbbreviation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[A-Za-z]{2,4}$/.test(text)) return null;
  return text.toUpperCase();
}

export function matchupLabel(away: string | null, home: string | null): string | null {
  if (away == null || home == null) return null;
  return `${away} @ ${home}`;
}

/**
 * Comma-separated game ids for Select Games.
 * Absent means All Games. Duplicates and non-numeric ids are rejected, not dropped.
 */
export function parseSelectedGameIds(raw: string, minimum = 2): SelectedGameIdParse {
  const parts = raw.split(',');
  if (parts.length === 0 || parts.some((part) => part.trim() === '')) {
    return { ok: false, status: 400, code: 'INVALID_GAME_SELECTION' };
  }
  const ids = parts.map((part) => part.trim());
  if (ids.some((id) => !/^\d{1,10}$/.test(id))) {
    return { ok: false, status: 400, code: 'INVALID_GAME_SELECTION' };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, status: 400, code: 'INVALID_GAME_SELECTION' };
  }
  if (ids.length > QUICK_BUILD_MAX_GAMES) {
    return { ok: false, status: 422, code: 'LIMIT_EXCEEDED' };
  }
  if (ids.length < minimum) {
    return { ok: false, status: 400, code: tooFewGamesCode(minimum) };
  }
  return { ok: true, ids };
}

function restrictToSelectedGames(
  games: QuickBuildGameInput[],
  selected: readonly string[],
  minimum = 2,
): QuickBuildGameInput[] {
  if (selected.length > QUICK_BUILD_MAX_GAMES) {
    throw new QuickBuildInputError('LIMIT_EXCEEDED', `games exceed ${QUICK_BUILD_MAX_GAMES}`);
  }
  if (selected.length < minimum) {
    throw new QuickBuildInputError(tooFewGamesCode(minimum), `at least ${minimum} games are required`);
  }
  if (new Set(selected).size !== selected.length) {
    throw new QuickBuildInputError('INELIGIBLE_GAME', 'selected games contain a duplicate');
  }
  const eligible = new Set(games.map((game) => game.gameId));
  if (selected.some((id) => !eligible.has(id))) {
    throw new QuickBuildInputError('INELIGIBLE_GAME', 'selected game is not eligible');
  }
  const want = new Set(selected);
  return games.filter((game) => want.has(game.gameId));
}

/** Upcoming game on the ET slate the props pipeline actually collects. */
export function isResearchSlateGame(
  game: { startTime: string; status?: string | null },
  now: Date
): boolean {
  const startMs = Date.parse(game.startTime);
  if (!Number.isFinite(startMs) || startMs <= now.getTime()) return false;
  if (etDateKey(new Date(startMs)) !== etDateKey(now)) return false;
  return normalizeGameStatus(game.status) === 'Scheduled';
}

function limit(code: string): never {
  throw new QuickBuildInputError('LIMIT_EXCEEDED', code);
}

function mapGames(rows: GameRow[], now: Date): QuickBuildGameInput[] {
  const games: QuickBuildGameInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const gameId = asId(row.game_id, 'game_id');
    if (seen.has(gameId)) {
      throw new QuickBuildInputError('MALFORMED_INPUT', 'games contains a duplicate gameId');
    }
    seen.add(gameId);
    const startTime = instantIso(row.start_time);
    if (startTime == null) continue;
    const status = row.status == null ? null : typeof row.status === 'string' ? row.status : null;
    if (row.status != null && typeof row.status !== 'string') {
      throw new QuickBuildInputError('MALFORMED_INPUT', 'game status is invalid');
    }
    if (!isResearchSlateGame({ startTime, status }, now)) continue;
    games.push({ gameId, startTime, status });
  }
  games.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.gameId.localeCompare(b.gameId));
  if (games.length > QUICK_BUILD_MAX_GAMES) limit(`games exceed ${QUICK_BUILD_MAX_GAMES}`);
  return games;
}

function mapAttempt(row: AttemptRow, gameIds: Set<string>): GamePullAttempt {
  const gameId = asId(row.game_id, 'attempt game_id');
  if (!gameIds.has(gameId)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'attempt game_id is outside the slate');
  }
  const status = row.status;
  if (status !== 'started' && status !== 'success' && status !== 'error') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'attempt status is invalid');
  }
  const rowsStored = typeof row.rows_stored === 'number' ? row.rows_stored : Number(row.rows_stored);
  if (!Number.isInteger(rowsStored) || rowsStored < 0) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'attempt rows_stored is invalid');
  }
  if (row.completed_at == null) {
    // An unfinished attempt has no completed_at. started_at is its only
    // ordering instant, so a pull still running can sort after the last success.
    const startedAt = row.started_at == null ? null : instantIso(row.started_at);
    if (row.started_at != null && startedAt == null) {
      throw new QuickBuildInputError('MALFORMED_INPUT', 'attempt started_at is invalid');
    }
    return {
      pullRunId: asId(row.pull_run_id, 'pull_run_id'),
      gameId,
      status,
      rowsStored,
      completedAt: startedAt,
      observationClock: null,
    };
  }
  const completedAt = instantIso(row.completed_at);
  if (completedAt == null) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'attempt completed_at is invalid');
  }
  return {
    pullRunId: asId(row.pull_run_id, 'pull_run_id'),
    gameId,
    status,
    rowsStored,
    completedAt,
    observationClock: null,
  };
}

function applyClock(attempts: GamePullAttempt[], clocks: ClockRow[]): GamePullAttempt[] {
  const byPair = new Map<string, { snapshotRows: number; responseRows: number }>();
  for (const row of clocks) {
    const key = `${asId(row.pull_run_id, 'clock pull_run_id')}|${asId(row.game_id, 'clock game_id')}`;
    byPair.set(key, {
      snapshotRows: asCount(row.snapshot_rows),
      responseRows: asCount(row.response_rows),
    });
  }
  return attempts.map((attempt) => {
    if (attempt.status !== 'success' || attempt.rowsStored <= 0) return attempt;
    const clock = byPair.get(`${attempt.pullRunId}|${attempt.gameId}`);
    const complete =
      clock != null && clock.snapshotRows > 0 && clock.responseRows === clock.snapshotRows;
    return { ...attempt, observationClock: complete ? 'RESPONSE_RECEIVED' : null };
  });
}

function latestCompleteByGame(attempts: GamePullAttempt[]): Map<string, GamePullAttempt> {
  const byGame = new Map<string, GamePullAttempt>();
  for (const attempt of attempts) {
    if (!isCompleteSuccess(attempt)) continue;
    const current = byGame.get(attempt.gameId);
    if (current == null || compareAttempts(current, attempt) < 0) {
      byGame.set(attempt.gameId, attempt);
    }
  }
  return byGame;
}

function pairKeys(latest: Map<string, GamePullAttempt>): { pullIds: number[]; gameIds: number[] } | null {
  const pullIds: number[] = [];
  const gameIds: number[] = [];
  for (const attempt of latest.values()) {
    const pullId = asBigint(attempt.pullRunId);
    const gameId = asInt4(attempt.gameId);
    if (pullId == null || gameId == null) {
      throw new QuickBuildInputError('MALFORMED_INPUT', 'eligible pull identity is not numeric');
    }
    pullIds.push(pullId);
    gameIds.push(gameId);
  }
  if (pullIds.length === 0) return null;
  return { pullIds, gameIds };
}

function mapObservation(row: ObservationRow): MarketObservationInput {
  const playerId = asId(row.player_id, 'snapshot player_id');
  const gameId = asId(row.game_id, 'snapshot game_id');
  const pullRunId = asId(row.pull_run_id, 'snapshot pull_run_id');
  if (typeof row.line_value !== 'string' || row.line_value.trim() === '') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'snapshot row is missing an identity or line');
  }
  if (row.observation_clock !== 'RESPONSE_RECEIVED') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'snapshot observation_clock is invalid');
  }
  const observedAt = instantIso(row.observed_at);
  if (observedAt == null) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'snapshot observed_at is invalid');
  }
  const odds = row.odds_american;
  if (odds != null && (typeof odds !== 'number' || !Number.isFinite(odds))) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'snapshot odds_american is invalid');
  }
  return {
    playerId,
    gameId,
    market: typeof row.prop_type === 'string' ? row.prop_type : '',
    side: typeof row.side === 'string' ? row.side : '',
    line: row.line_value,
    sportsbook: typeof row.sportsbook === 'string' ? row.sportsbook : '',
    oddsAmerican: odds == null ? null : odds,
    pullRunId,
    observedAt,
    observationClock: 'RESPONSE_RECEIVED',
  };
}

export async function loadResearchSlate(args: {
  now: Date;
  query: QuickBuildReader;
}): Promise<{ asOf: string; games: ResearchSlateGame[] }> {
  if (!(args.now instanceof Date) || !Number.isFinite(args.now.getTime())) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'server time is invalid');
  }
  const asOf = args.now.toISOString();
  const rows = requireRows(await args.query(QUICK_BUILD_SLATE_SQL, [etDateKey(args.now), asOf]), 'games') as GameRow[];
  const games = mapGames(rows, args.now);
  const labels = new Map<string, { away: string | null; home: string | null }>();
  for (const row of rows) {
    if (typeof row.game_id !== 'number' && (typeof row.game_id !== 'string' || row.game_id.trim() === '')) continue;
    const gameId = asId(row.game_id, 'game_id');
    labels.set(gameId, { away: cleanAbbreviation(row.away_abbr), home: cleanAbbreviation(row.home_abbr) });
  }
  return {
    asOf,
    games: games.map((game) => {
      const teams = labels.get(game.gameId);
      const away = teams?.away ?? null;
      const home = teams?.home ?? null;
      return {
        gameId: game.gameId,
        startTime: game.startTime,
        awayAbbreviation: away,
        homeAbbreviation: home,
        label: matchupLabel(away, home),
      };
    }),
  };
}

type ResearchPresetName =
  | QuickBuildPresetName
  | QuickBuildThreeLegPresetName
  | QuickBuildFourLegPresetName
  | QuickBuildFiveLegPresetName;

function tooFewGamesCode(minimum: number): 'NEED_TWO_GAMES' | 'NEED_THREE_GAMES' | 'NEED_FOUR_GAMES' | 'NEED_FIVE_GAMES' {
  if (minimum >= 5) return 'NEED_FIVE_GAMES';
  if (minimum === 4) return 'NEED_FOUR_GAMES';
  if (minimum === 3) return 'NEED_THREE_GAMES';
  return 'NEED_TWO_GAMES';
}

function presetRangeFor(legCount: 2 | 3 | 4 | 5, preset: ResearchPresetName): { minAmerican: number; maxAmerican: number } | undefined {
  if (legCount === 5) return QUICK_BUILD_FIVE_LEG_PRESETS[preset as QuickBuildFiveLegPresetName];
  if (legCount === 4) return QUICK_BUILD_FOUR_LEG_PRESETS[preset as QuickBuildFourLegPresetName];
  if (legCount === 3) return QUICK_BUILD_THREE_LEG_PRESETS[preset as QuickBuildThreeLegPresetName];
  return QUICK_BUILD_PRESETS[preset as QuickBuildPresetName];
}

function researchPriceNotice(legCount: 2 | 3 | 4 | 5): string {
  if (legCount === 5) return QUICK_BUILD_FIVE_LEG_PRICE_NOTICE;
  if (legCount === 4) return QUICK_BUILD_FOUR_LEG_PRICE_NOTICE;
  if (legCount === 3) return QUICK_BUILD_THREE_LEG_PRICE_NOTICE;
  return QUICK_BUILD_PRICE_NOTICE;
}

export async function buildResearchQuickBuildRequest(args: {
  sportsbook: string;
  preset: ResearchPresetName;
  now: Date;
  query: QuickBuildReader;
  /** Omitted means two legs. */
  legCount?: 2 | 3 | 4 | 5;
  /** Omitted for All Games. When present, attempts and observations use only these ids. */
  gameIds?: readonly string[];
}): Promise<QuickBuildRequest> {
  if (!(args.now instanceof Date) || !Number.isFinite(args.now.getTime())) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'server time is invalid');
  }
  const book = canonicalizeSportsbook(args.sportsbook);
  if (!book) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'sportsbook is not a supported parlay book');
  }
  const legCount = args.legCount ?? 2;
  if (legCount !== 2 && legCount !== 3 && legCount !== 4 && legCount !== 5) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'leg count must be 2, 3, 4, or 5');
  }
  const presetRangeRow = presetRangeFor(legCount, args.preset);
  if (presetRangeRow == null) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'preset does not match the leg count');
  }
  const asOf = args.now.toISOString();
  const gameRows = requireRows(
    await args.query(QUICK_BUILD_GAMES_SQL, [etDateKey(args.now), asOf]),
    'games'
  ) as GameRow[];
  const minimumGames = legCount;
  const games = args.gameIds == null
    ? mapGames(gameRows, args.now)
    : restrictToSelectedGames(mapGames(gameRows, args.now), args.gameIds, minimumGames);
  const gameIds = games.map((game) => game.gameId);

  let attempts: GamePullAttempt[] = [];
  if (gameIds.length > 0) {
    const attemptRows = requireRows(await args.query(QUICK_BUILD_ATTEMPTS_SQL, [gameIds]), 'attempts') as AttemptRow[];
    if (attemptRows.length > QUICK_BUILD_MAX_ATTEMPTS) limit(`attempts exceed ${QUICK_BUILD_MAX_ATTEMPTS}`);
    const gameIdSet = new Set(gameIds);
    attempts = attemptRows.map((row) => mapAttempt(row, gameIdSet));

    const clockCandidates = attempts.filter(
      (attempt) =>
        attempt.status === 'success' &&
        attempt.rowsStored > 0 &&
        asBigint(attempt.pullRunId) != null &&
        asInt4(attempt.gameId) != null
    );
    if (clockCandidates.length > 0) {
      const clocks = requireRows(
        await args.query(QUICK_BUILD_CLOCK_SQL, [
          clockCandidates.map((attempt) => asBigint(attempt.pullRunId) as number),
          clockCandidates.map((attempt) => asInt4(attempt.gameId) as number),
        ]),
        'clocks'
      ) as ClockRow[];
      attempts = applyClock(attempts, clocks);
    }
  }

  const latest = latestCompleteByGame(attempts);
  const keys = pairKeys(latest);
  let observations: MarketObservationInput[] = [];
  if (keys != null) {
    const params = [keys.pullIds, keys.gameIds, book.vendor, CANONICAL_MARKETS];
    const counted = requireRows(
      await args.query(QUICK_BUILD_OBSERVATION_COUNT_SQL, params),
      'observation count'
    ) as Array<{ observation_count: unknown }>;
    const count = asCount(counted[0]?.observation_count ?? 0);
    if (count > QUICK_BUILD_MAX_OBSERVATIONS) limit(`observations exceed ${QUICK_BUILD_MAX_OBSERVATIONS}`);
    if (count > 0) {
      const rows = requireRows(
        await args.query(QUICK_BUILD_OBSERVATION_ROWS_SQL, params),
        'observations'
      ) as ObservationRow[];
      if (rows.length > QUICK_BUILD_MAX_OBSERVATIONS) limit(`observations exceed ${QUICK_BUILD_MAX_OBSERVATIONS}`);
      observations = rows.map(mapObservation);
    }
  }

  return {
    sportsbook: book.vendor,
    range: { minAmerican: presetRangeRow.minAmerican, maxAmerican: presetRangeRow.maxAmerican },
    policy: { mode: 'research_snapshot', asOf },
    games,
    attempts,
    observations,
    legCount,
  };
}

export async function loadResearchQuickBuilds(args: {
  sportsbook: string;
  preset: ResearchPresetName;
  now: Date;
  query: QuickBuildReader;
  legCount?: 2 | 3 | 4 | 5;
  gameIds?: readonly string[];
}): Promise<QuickBuildApiBody> {
  const request = await buildResearchQuickBuildRequest(args);
  const generated = generateQuickBuilds(request);
  const { searchStats, ...result } = generated;
  void searchStats;
  const playerIds = [...new Set(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId)))];
  let playerRows: PlayerNameRow[] = [];
  if (playerIds.length > 0) {
    const rows = requireRows(await args.query(QUICK_BUILD_PLAYERS_SQL, [playerIds]), 'players') as Array<{
      player_id: unknown;
      full_name: unknown;
    }>;
    playerRows = rows.map((row) => ({
      playerId: asId(row.player_id, 'player_id'),
      fullName: typeof row.full_name === 'string' ? row.full_name : null,
    }));
  }
  const notice = researchPriceNotice(request.legCount ?? 2);
  const limitations = result.searchComplete === false
    ? [QUICK_BUILD_RESEARCH_LIMITATION, notice, QUICK_BUILD_SEARCH_BUDGET_NOTE]
    : [QUICK_BUILD_RESEARCH_LIMITATION, notice];
  return {
    ...result,
    builds: attachQuickBuildDisplay({ builds: result.builds, games: request.games, playerRows }),
    generatedAt: request.policy.asOf,
    preset: args.preset,
    snapshotClass: 'research_snapshot',
    limitations,
  };
}
