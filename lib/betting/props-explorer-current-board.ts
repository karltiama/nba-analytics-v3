import { query } from '@/lib/db';
import { noVigProbability } from '@/lib/betting/market-probability';
import { isActivePaperBetAllowed, LATEST_OBSERVED_LINE_LABEL } from '@/lib/betting/props-market-context';
import type { GetPlayerPropsForExplorerInput, PropsExplorerBestPrice, PropsExplorerRow, SelectedExplorerGame } from '@/lib/betting/props-explorer-serving';
import {
  defaultCurrentBoardStore,
  readCurrentBoard,
  type CurrentBoardResponse,
  type CurrentBoardRow,
  type CurrentBoardStore,
} from '@/lib/props/s3-current-board/read';

export const CURRENT_BOARD_UNAVAILABLE_LABEL = 'Unavailable';
export const S3_CURRENT_PROPS_SOURCE = 's3.player_prop_current' as const;

const GAMES_SQL = `
SELECT g.game_id::text AS game_id,
       g.start_time,
       t_away.abbreviation AS away_abbr,
       t_home.abbreviation AS home_abbr
  FROM analytics.games g
  LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id
  LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
 WHERE g.start_time >= ($1::timestamp AT TIME ZONE 'America/New_York')
   AND g.start_time < (($1::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')
`;

const PLAYERS_SQL = `
SELECT player_id::text AS player_id, full_name
  FROM analytics.players
 WHERE player_id::text = ANY($1::text[])
`;

type GameIdentity = {
  gameId: string;
  startTime: string | null;
  awayAbbr: string | null;
  homeAbbr: string | null;
};

type ListedRow = {
  game: GameIdentity;
  board: Extract<CurrentBoardResponse, { available: true }>;
  row: CurrentBoardRow;
  playerName: string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function decimalFromAmerican(american: number | null): number | null {
  if (american == null || american === 0) return null;
  return american < 0 ? 1 + 100 / Math.abs(american) : 1 + american / 100;
}

function matches(input: GetPlayerPropsForExplorerInput, row: ListedRow): boolean {
  const marketType = (input.marketType || 'over_under').trim().toLowerCase();
  if (marketType !== 'all' && row.row.marketType.toLowerCase() !== marketType) return false;
  const side = (input.side || 'all').toLowerCase();
  if (side !== 'all' && row.row.side.toLowerCase() !== side) return false;
  const propType = (input.propType ?? '').trim().toLowerCase();
  if (propType) {
    const pattern = propType.endsWith('%') ? propType.slice(0, -1) : propType;
    if (!row.row.propType.toLowerCase().startsWith(pattern)) return false;
  }
  const books = (input.sportsbook ?? '').split(',').map((book) => book.trim().toLowerCase()).filter(Boolean);
  if (books.length > 0 && !books.includes(row.row.sportsbook.trim().toLowerCase())) return false;
  const playerName = (input.playerName ?? '').trim().toLowerCase();
  if (playerName && !(row.playerName ?? '').toLowerCase().includes(playerName)) return false;
  return true;
}

export async function serveLivePropsFromCurrentBoard(input: GetPlayerPropsForExplorerInput & {
  now: Date;
  selectedGame: SelectedExplorerGame | null;
  gameStart: string | Date | null;
}): Promise<{
  rows: PropsExplorerRow[];
  totalMatching: number;
  marketContext: 'live';
  sourceTable: typeof S3_CURRENT_PROPS_SOURCE;
  lineLabel: string;
  dateEt: string;
  evSelectedTrack: string;
  calibrationVersion: null;
  evFetchCap: null;
  sort: string;
  selectedGame: SelectedExplorerGame | null;
  priceScope: 'selected_books' | 'market';
}> {
  const store: CurrentBoardStore = input.store ?? defaultCurrentBoardStore();
  const gameId = (input.gameId ?? '').trim();
  let games: GameIdentity[] = [];
  if (gameId) {
    if (input.selectedGame?.found) {
      games = [{
        gameId,
        startTime: input.gameStart == null ? null : input.gameStart instanceof Date ? input.gameStart.toISOString() : String(input.gameStart),
        awayAbbr: input.selectedGame.awayAbbr,
        homeAbbr: input.selectedGame.homeAbbr,
      }];
    }
  } else {
    const found = await query<{ game_id: string; start_time: string | Date | null; away_abbr: string | null; home_abbr: string | null }>(GAMES_SQL, [input.dateEt]);
    games = (Array.isArray(found) ? found : []).map((game) => ({
      gameId: String(game.game_id),
      startTime: game.start_time == null ? null : game.start_time instanceof Date ? game.start_time.toISOString() : String(game.start_time),
      awayAbbr: text(game.away_abbr),
      homeAbbr: text(game.home_abbr),
    }));
  }

  const boards: Array<{ game: GameIdentity; board: Extract<CurrentBoardResponse, { available: true }> }> = [];
  for (const game of games) {
    const board = await readCurrentBoard({ store, gameId: game.gameId, now: input.now.toISOString() });
    if (board.available) boards.push({ game, board });
  }
  const playerIds = [...new Set(boards.flatMap((item) => item.board.rows.map((row) => row.playerId)))];
  const names = new Map<string, string | null>();
  if (playerIds.length > 0) {
    const players = await query<{ player_id: string; full_name: string | null }>(PLAYERS_SQL, [playerIds]);
    for (const player of Array.isArray(players) ? players : []) names.set(String(player.player_id), player.full_name ?? null);
  }

  const listed: ListedRow[] = [];
  for (const item of boards) {
    for (const row of item.board.rows) {
      const entry = { game: item.game, board: item.board, row, playerName: names.get(row.playerId) ?? null };
      if (matches(input, entry)) listed.push(entry);
    }
  }

  const sortRaw = (input.sort || 'snapshot_at').toLowerCase();
  const sort = sortRaw === 'edge' ? 'snapshot_at' : sortRaw;
  const direction = input.dirAsc ? 1 : -1;
  listed.sort((left, right) => {
    if (sort === 'odds_american') return direction * ((left.row.oddsAmerican ?? 0) - (right.row.oddsAmerican ?? 0));
    return direction * (Date.parse(left.board.observedAt) - Date.parse(right.board.observedAt));
  });

  const books = (input.sportsbook ?? '').split(',').map((book) => book.trim().toLowerCase()).filter(Boolean);
  const priceScope = books.length === 1 ? 'market' : 'selected_books';
  const totalMatching = listed.length;
  const page = listed.slice(input.offset, input.offset + input.limit);
  const rows: PropsExplorerRow[] = page.map((entry) => {
    const sameLine = listed.filter((other) =>
      other.game.gameId === entry.game.gameId
      && other.row.playerId === entry.row.playerId
      && other.row.propType === entry.row.propType
      && other.row.side.toLowerCase() === entry.row.side.toLowerCase()
      && other.row.line === entry.row.line
      && other.row.oddsAmerican != null
    );
    const best = sameLine.slice().sort((a, b) => (decimalFromAmerican(b.row.oddsAmerican) ?? 0) - (decimalFromAmerican(a.row.oddsAmerican) ?? 0))[0];
    const decimals = sameLine.map((item) => decimalFromAmerican(item.row.oddsAmerican)).filter((value): value is number => value != null);
    const average = decimals.length > 0 ? decimals.reduce((sum, value) => sum + value, 0) / decimals.length : null;
    const ownDecimal = entry.row.oddsDecimal ?? decimalFromAmerican(entry.row.oddsAmerican);
    const bestDecimal = best ? decimalFromAmerican(best.row.oddsAmerican) : null;
    const bestPrice: PropsExplorerBestPrice | null = bestDecimal == null || bestDecimal <= 1 || sameLine.length < 1
      ? null
      : {
          oddsAmerican: best?.row.oddsAmerican ?? null,
          oddsDecimal: bestDecimal,
          sportsbook: best?.row.sportsbook ?? null,
          bookCount: sameLine.length,
          isBest: ownDecimal != null && ownDecimal >= bestDecimal - 1e-9,
          vsAverage: sameLine.length >= 2 && ownDecimal != null && average != null && average > 0 ? ownDecimal / average - 1 : null,
          marketWide: priceScope === 'market',
        };
    const opposite = listed.find((other) =>
      other.game.gameId === entry.game.gameId
      && other.row.playerId === entry.row.playerId
      && other.row.sportsbook === entry.row.sportsbook
      && other.row.propType === entry.row.propType
      && other.row.line === entry.row.line
      && other.row.side.toLowerCase() !== entry.row.side.toLowerCase()
    );
    const offerP = entry.row.impliedProbability ?? null;
    return {
      gameId: entry.game.gameId,
      playerId: Number(entry.row.playerId),
      playerName: entry.playerName,
      sportsbook: entry.row.sportsbook,
      propType: entry.row.propType,
      marketType: entry.row.marketType,
      side: entry.row.side,
      lineValue: entry.row.line,
      oddsAmerican: entry.row.oddsAmerican,
      oddsDecimal: ownDecimal,
      impliedProbability: offerP,
      fairProbability: entry.row.marketType.toLowerCase() === 'over_under'
        ? noVigProbability(offerP, opposite?.row.impliedProbability ?? null)
        : null,
      bestPrice,
      arb: null,
      movement: null,
      snapshotAt: entry.board.observedAt,
      marketContext: 'live',
      lineLabel: LATEST_OBSERVED_LINE_LABEL,
      paperBetAllowed: isActivePaperBetAllowed({ gameStartTime: entry.game.startTime, now: input.now }),
      sourceTable: S3_CURRENT_PROPS_SOURCE,
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
  });

  const available = boards.length > 0;
  return {
    rows,
    totalMatching,
    marketContext: 'live',
    sourceTable: S3_CURRENT_PROPS_SOURCE,
    lineLabel: available ? LATEST_OBSERVED_LINE_LABEL : CURRENT_BOARD_UNAVAILABLE_LABEL,
    dateEt: input.dateEt,
    evSelectedTrack: 's3',
    calibrationVersion: null,
    evFetchCap: null,
    sort,
    selectedGame: input.selectedGame,
    priceScope,
  };
}
