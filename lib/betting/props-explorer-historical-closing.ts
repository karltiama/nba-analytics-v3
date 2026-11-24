/**
 * Past-date Props Explorer loader for one verified S3 closing artifact.
 * PostgreSQL decision rows win for that game. A missing artifact is unavailable, not an empty board.
 * The browser never supplies an object key.
 */
import { query } from '@/lib/db';
import { propsLineLabel, type PropsServingSource } from '@/lib/betting/props-market-context';
import {
  priceScopeForBooks,
  type GetPlayerPropsForExplorerInput,
  type PriceScope,
  type PropsExplorerRow,
  type SelectedExplorerGame,
} from '@/lib/betting/props-explorer-serving';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { historicalPropsSource } from '@/lib/props/s3-closing/source';
import type { CurrentPropsObjectStore } from '@/lambda/player-props-snapshot/src/f39b/store';
import type { DecisionCloseRow } from '@/lambda/player-props-snapshot/src/s3-closing-selection';
import {
  assessClosingCoverage,
  closingSnapshotKey,
  decisionRowsFromClosingArtifact,
  PULL_INVENTORY_SQL,
  type ClosingGame,
  type ClosingSnapshot,
  type GameRunRecord,
  type PullEvidence,
  type PullFinding,
} from '@/lambda/player-props-snapshot/src/s3-closing-snapshot';

export const S3_CLOSING_PROPS_SOURCE = 's3.player_prop_closing' as const;
export const HISTORICAL_CLOSING_UNAVAILABLE_LABEL = 'Unavailable';
const GAME_ID_PATTERN = /^[0-9]{1,20}$/;

export type HistoricalUnavailableReason =
  | 'invalid_game'
  | 'not_final'
  | 'missing'
  | 'invalid_checksum'
  | 'identity'
  | 'incomplete'
  | 'missing_archive'
  | 'unverifiable'
  | 'duplicate'
  | 'unconfigured';

export type HistoricalUnavailableGame = {
  gameId: string;
  reason: HistoricalUnavailableReason;
};

export type HistoricalClosingLoad =
  | { status: 'postgres' }
  | { status: 's3'; rows: DecisionCloseRow[] }
  | { status: 'unavailable'; reason: HistoricalUnavailableReason };

type GameRecord = {
  gameId: string;
  status: string;
  gameDate: string | null;
  startTime: string | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
};

type ListedLine = {
  source: PropsServingSource;
  game: GameRecord;
  line: DecisionCloseRow;
};

const GAME_SQL = `
SELECT g.game_id::text AS game_id, g.status, g.game_date::text AS game_date, g.start_time,
       t_away.abbreviation AS away_abbr, t_home.abbreviation AS home_abbr
  FROM analytics.games g
  LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id
  LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
 WHERE g.game_id::text = $1
`;

const DATE_GAMES_SQL = `
SELECT g.game_id::text AS game_id, g.status, g.game_date::text AS game_date, g.start_time,
       t_away.abbreviation AS away_abbr, t_home.abbreviation AS home_abbr
  FROM analytics.games g
  LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id
  LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
 WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
   AND g.start_time < (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
 ORDER BY g.game_id::text
`;

const DECISION_COUNT_SQL = `
SELECT count(*)::text AS n
  FROM research.prop_decision_lines
 WHERE game_id = $1
`;

const DECISION_COUNTS_SQL = `
SELECT game_id, count(*)::text AS n
  FROM research.prop_decision_lines
 WHERE game_id = ANY($1::text[])
 GROUP BY game_id
`;

const DECISION_ROWS_SQL = `
SELECT p.game_id::text AS game_id, p.player_id::text AS player_id,
       COALESCE(p.player_name, pl.full_name) AS player_name,
       p.team_id, p.sportsbook, p.prop_type, p.market_type, p.side,
       p.line_value, p.odds_american, p.odds_decimal, p.implied_probability,
       p.decision_at, p.game_start_time, p.decision_clock
  FROM research.prop_decision_lines p
  INNER JOIN analytics.games g ON g.game_id = p.game_id
  LEFT JOIN analytics.players pl ON pl.player_id = p.player_id
 WHERE p.game_id = ANY($1::text[])
`;

function asText(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gameFromRow(row: {
  game_id: string;
  status: string;
  game_date: string | null;
  start_time: string | Date | null;
  away_abbr: string | null;
  home_abbr: string | null;
}): GameRecord {
  return {
    gameId: String(row.game_id),
    status: row.status,
    gameDate: row.game_date,
    startTime: asText(row.start_time),
    awayAbbr: asText(row.away_abbr),
    homeAbbr: asText(row.home_abbr),
  };
}

function coverageReason(findings: readonly PullFinding[]): HistoricalUnavailableReason {
  if (findings.length === 0 || findings.some((item) => item.state === 'game_run_absent')) return 'unverifiable';
  if (findings.some((item) => item.state === 'missing_archive')) return 'missing_archive';
  return 'incomplete';
}

function pullEvidence(row: {
  pull_run_id: number | string;
  game_status: string | null;
  archive_status: GameRunRecord['archiveStatus'];
  archive_key: string | null;
  started_at: string | Date | null;
  rows_fetched: number | null;
  rows_stored: number | null;
  provider_attempts: number | null;
}): PullEvidence {
  const startedAt = asText(row.started_at);
  const hasRun = row.game_status != null || row.archive_status != null || row.archive_key != null || startedAt != null;
  return {
    pullRunId: Number(row.pull_run_id),
    queriedGame: true,
    gameRun: hasRun
      ? {
          status: row.game_status === 'error' || row.game_status === 'started' ? row.game_status : 'success',
          archiveStatus: row.archive_status,
          archiveKey: row.archive_key,
          startedAt,
          rowsFetched: row.rows_fetched == null ? null : Number(row.rows_fetched),
          rowsStored: row.rows_stored == null ? null : Number(row.rows_stored),
          providerAttempts: row.provider_attempts == null ? null : Number(row.provider_attempts),
        }
      : null,
  };
}

function lineIdentity(line: DecisionCloseRow): string {
  return [line.gameId, line.playerId, line.sportsbook, line.propType, line.side].join('|');
}

export async function loadHistoricalClosingForGame(args: {
  gameId: string;
  store: CurrentPropsObjectStore | null;
}): Promise<HistoricalClosingLoad> {
  const gameId = args.gameId.trim();
  if (!GAME_ID_PATTERN.test(gameId)) return { status: 'unavailable', reason: 'invalid_game' };
  const counted = await query<{ n: string }>(DECISION_COUNT_SQL, [gameId]);
  if (Number(counted[0]?.n ?? 0) > 0) return { status: 'postgres' };
  const found = await query<{
    game_id: string;
    status: string;
    game_date: string | null;
    start_time: string | Date | null;
    away_abbr: string | null;
    home_abbr: string | null;
  }>(GAME_SQL, [gameId]);
  const game = found[0] ? gameFromRow(found[0]) : null;
  if (!game || game.status !== 'Final' || game.startTime == null || game.gameDate == null) {
    return { status: 'unavailable', reason: 'not_final' };
  }
  if (!args.store) return { status: 'unavailable', reason: 'unconfigured' };
  const closingGame: ClosingGame = {
    gameId,
    gameDate: game.gameDate,
    status: game.status,
    startTime: game.startTime,
  };
  const pulls = await query<{
    pull_run_id: number | string;
    game_status: string | null;
    archive_status: GameRunRecord['archiveStatus'];
    archive_key: string | null;
    started_at: string | Date | null;
    rows_fetched: number | null;
    rows_stored: number | null;
    provider_attempts: number | null;
  }>(PULL_INVENTORY_SQL, [gameId]);
  const coverage = await assessClosingCoverage({
    store: args.store,
    game: closingGame,
    pulls: pulls.map(pullEvidence),
  });
  if (coverage.completeness !== 'complete') {
    return { status: 'unavailable', reason: coverageReason(coverage.findings) };
  }
  const stored = await args.store.get(closingSnapshotKey(closingGame));
  if (!stored) return { status: 'unavailable', reason: 'missing' };
  let artifact: ClosingSnapshot;
  try {
    artifact = JSON.parse(stored.body.toString('utf8')) as ClosingSnapshot;
  } catch {
    return { status: 'unavailable', reason: 'invalid_checksum' };
  }
  if (artifact.gameId !== gameId || artifact.gameDate !== game.gameDate || artifact.completeness !== 'complete') {
    return { status: 'unavailable', reason: 'identity' };
  }
  if (artifact.marketCount !== artifact.lines?.length) return { status: 'unavailable', reason: 'incomplete' };
  let rows: DecisionCloseRow[];
  try {
    rows = decisionRowsFromClosingArtifact(artifact);
  } catch {
    return { status: 'unavailable', reason: 'invalid_checksum' };
  }
  const seen = new Set<string>();
  for (const line of rows) {
    if (seen.has(lineIdentity(line))) return { status: 'unavailable', reason: 'duplicate' };
    seen.add(lineIdentity(line));
  }
  return { status: 's3', rows };
}

function matches(input: GetPlayerPropsForExplorerInput, line: DecisionCloseRow): boolean {
  const marketType = (input.marketType || 'over_under').trim().toLowerCase();
  if (marketType !== 'all' && (line.marketType ?? '').toLowerCase() !== marketType) return false;
  const side = (input.side || 'all').toLowerCase();
  if (side !== 'all' && line.side.toLowerCase() !== side) return false;
  const propType = (input.propType ?? '').trim().toLowerCase();
  if (propType) {
    const pattern = propType.endsWith('%') ? propType.slice(0, -1) : propType;
    if (!line.propType.toLowerCase().startsWith(pattern)) return false;
  }
  const books = (input.sportsbook ?? '').split(',').map((book) => book.trim().toLowerCase()).filter(Boolean);
  if (books.length > 0 && !books.includes(line.sportsbook.trim().toLowerCase())) return false;
  const playerName = (input.playerName ?? '').trim().toLowerCase();
  if (playerName && !(line.playerName ?? '').toLowerCase().includes(playerName)) return false;
  return true;
}

function explorerRow(entry: ListedLine): PropsExplorerRow {
  return {
    gameId: entry.line.gameId,
    playerId: Number(entry.line.playerId),
    playerName: entry.line.playerName,
    sportsbook: entry.line.sportsbook,
    propType: entry.line.propType,
    marketType: entry.line.marketType,
    side: entry.line.side,
    lineValue: entry.line.lineValue,
    oddsAmerican: entry.line.oddsAmerican,
    oddsDecimal: entry.line.oddsDecimal,
    impliedProbability: entry.line.impliedProbability,
    fairProbability: null,
    bestPrice: null,
    arb: null,
    movement: null,
    snapshotAt: entry.line.decisionAt,
    marketContext: 'historical',
    lineLabel: propsLineLabel('historical'),
    paperBetAllowed: false,
    sourceTable: entry.source,
    nbaPlayerId: null,
    awayTeamAbbr: entry.game.awayAbbr,
    homeTeamAbbr: entry.game.homeAbbr,
    modelProbability: null,
    ev: null,
    projection: null,
    confidenceTier: null,
    evTrackA: null,
    evTrackB: null,
  };
}

function sortRows(rows: PropsExplorerRow[], sort: string, dirAsc: boolean): PropsExplorerRow[] {
  const direction = dirAsc ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort === 'odds_american') return direction * ((left.oddsAmerican ?? 0) - (right.oddsAmerican ?? 0));
    const leftAt = Number.isFinite(Date.parse(left.snapshotAt)) ? Date.parse(left.snapshotAt) : Number.NEGATIVE_INFINITY;
    const rightAt = Number.isFinite(Date.parse(right.snapshotAt)) ? Date.parse(right.snapshotAt) : Number.NEGATIVE_INFINITY;
    return direction * (leftAt - rightAt);
  });
}

export async function serveHistoricalClosingIfNeeded(args: {
  input: GetPlayerPropsForExplorerInput;
  selectedGame: SelectedExplorerGame | null;
}): Promise<{
  rows: PropsExplorerRow[];
  totalMatching: number;
  marketContext: 'historical';
  sourceTable: PropsServingSource;
  lineLabel: string;
  dateEt: string;
  evSelectedTrack: string;
  calibrationVersion: null;
  evFetchCap: null;
  sort: string;
  selectedGame: SelectedExplorerGame | null;
  priceScope: PriceScope;
  unavailableGames: HistoricalUnavailableGame[];
} | null> {
  if (historicalPropsSource() !== 's3_closing') return null;
  const input = args.input;
  const gameId = (input.gameId ?? '').trim();
  const unavailable: HistoricalUnavailableGame[] = [];
  const listed: ListedLine[] = [];
  let games: GameRecord[] = [];

  if (gameId) {
    if (!GAME_ID_PATTERN.test(gameId)) {
      return page(input, args.selectedGame, [], [{ gameId, reason: 'invalid_game' }]);
    }
    const count = await query<{ n: string }>(DECISION_COUNT_SQL, [gameId]);
    if (Number(count[0]?.n ?? 0) > 0) return null;
    const loaded = await loadHistoricalClosingForGame({ gameId, store: input.closingStore ?? null });
    if (loaded.status === 'postgres') return null;
    const found = await query<{
      game_id: string;
      status: string;
      game_date: string | null;
      start_time: string | Date | null;
      away_abbr: string | null;
      home_abbr: string | null;
    }>(GAME_SQL, [gameId]);
    const game = found[0] ? gameFromRow(found[0]) : {
      gameId,
      status: 'Final',
      gameDate: null,
      startTime: null,
      awayAbbr: null,
      homeAbbr: null,
    };
    if (loaded.status === 'unavailable') unavailable.push({ gameId, reason: loaded.reason });
    if (loaded.status === 's3') {
      for (const line of loaded.rows) listed.push({ source: S3_CLOSING_PROPS_SOURCE, game, line });
    }
    return page(input, args.selectedGame, listed, unavailable);
  }

  const found = await query<{
    game_id: string;
    status: string;
    game_date: string | null;
    start_time: string | Date | null;
    away_abbr: string | null;
    home_abbr: string | null;
  }>(DATE_GAMES_SQL, [input.dateEt]);
  games = found.map(gameFromRow);
  if (games.length === 0) return page(input, args.selectedGame, [], []);
  const counts = await query<{ game_id: string; n: string }>(DECISION_COUNTS_SQL, [games.map((game) => game.gameId)]);
  const counted = new Map(counts.map((row) => [String(row.game_id), Number(row.n)]));
  if (games.every((game) => (counted.get(game.gameId) ?? 0) > 0)) return null;

  const postgresIds = games.filter((game) => (counted.get(game.gameId) ?? 0) > 0).map((game) => game.gameId);
  if (postgresIds.length > 0) {
    const rows = await query<{
      game_id: string;
      player_id: string;
      player_name: string | null;
      team_id: number | null;
      sportsbook: string;
      prop_type: string;
      market_type: string | null;
      side: string;
      line_value: string | number | null;
      odds_american: number | null;
      odds_decimal: string | number | null;
      implied_probability: string | number | null;
      decision_at: string | Date;
      game_start_time: string | Date;
      decision_clock: 'RESPONSE_RECEIVED' | null;
    }>(DECISION_ROWS_SQL, [postgresIds]);
    for (const row of rows) {
      const game = games.find((item) => item.gameId === String(row.game_id));
      if (!game) continue;
      listed.push({
        source: 'research.prop_decision_lines',
        game,
        line: {
          gameId: String(row.game_id),
          playerId: String(row.player_id),
          playerName: row.player_name,
          teamId: row.team_id == null ? null : Number(row.team_id),
          sportsbook: row.sportsbook,
          propType: row.prop_type,
          marketType: row.market_type ?? 'over_under',
          side: row.side,
          lineValue: asNumber(row.line_value),
          oddsAmerican: row.odds_american,
          oddsDecimal: asNumber(row.odds_decimal),
          impliedProbability: asNumber(row.implied_probability),
          decisionAt: asText(row.decision_at) ?? '',
          gameStartTime: asText(row.game_start_time) ?? '',
          decisionClock: 'RESPONSE_RECEIVED',
        },
      });
    }
  }
  for (const game of games) {
    if ((counted.get(game.gameId) ?? 0) > 0) continue;
    const loaded = await loadHistoricalClosingForGame({ gameId: game.gameId, store: input.closingStore ?? null });
    if (loaded.status === 's3') {
      for (const line of loaded.rows) listed.push({ source: S3_CLOSING_PROPS_SOURCE, game, line });
    } else if (loaded.status === 'unavailable') {
      unavailable.push({ gameId: game.gameId, reason: loaded.reason });
    }
  }
  return page(input, args.selectedGame, listed, unavailable);
}

function page(
  input: GetPlayerPropsForExplorerInput,
  selectedGame: SelectedExplorerGame | null,
  listed: ListedLine[],
  unavailable: HistoricalUnavailableGame[]
) {
  const filtered = listed.filter((entry) => matches(input, entry.line));
  const sortRaw = (input.sort || 'snapshot_at').toLowerCase();
  const sort = sortRaw === 'edge' ? 'snapshot_at' : sortRaw;
  const rows = sortRows(filtered.map(explorerRow), sort, Boolean(input.dirAsc));
  const books = (input.sportsbook ?? '').split(',').map((book) => book.trim().toLowerCase()).filter(Boolean);
  const usedS3 = listed.some((entry) => entry.source === S3_CLOSING_PROPS_SOURCE);
  const sourceTable: PropsServingSource = usedS3 || (unavailable.length > 0 && listed.length === 0)
    ? S3_CLOSING_PROPS_SOURCE
    : 'research.prop_decision_lines';
  return {
    rows: rows.slice(input.offset, input.offset + input.limit),
    totalMatching: rows.length,
    marketContext: 'historical' as const,
    sourceTable,
    lineLabel: rows.length === 0 && unavailable.length > 0 ? HISTORICAL_CLOSING_UNAVAILABLE_LABEL : propsLineLabel('historical'),
    dateEt: input.dateEt,
    evSelectedTrack: resolveEvTrack(),
    calibrationVersion: null as null,
    evFetchCap: null as null,
    sort,
    selectedGame,
    priceScope: priceScopeForBooks(books),
    unavailableGames: unavailable,
  };
}
