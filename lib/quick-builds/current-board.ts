import { generateQuickBuilds } from '@/lib/quick-builds';
import { attachQuickBuildDisplay, QUICK_BUILD_PLAYERS_SQL, type PlayerNameRow, type QuickBuildDisplayed } from '@/lib/quick-builds/display';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { BASE_SCHEDULE_FRESHNESS_MS } from '@/lib/props/s3-current-board/pointer';
import { defaultCurrentBoardStore, readCurrentBoard, type CurrentBoardResponse, type CurrentBoardStore } from '@/lib/props/s3-current-board/read';
import { QUICK_BUILD_GAMES_SQL, type QuickBuildApiBody, type QuickBuildReader } from '@/lib/quick-builds/research-snapshot';
import {
  QUICK_BUILD_FIVE_LEG_PRESETS,
  QUICK_BUILD_FOUR_LEG_PRESETS,
  QUICK_BUILD_MAX_OBSERVATIONS,
  QUICK_BUILD_MAX_RAW_BOARD_ROWS,
  QUICK_BUILD_MAX_RAW_ROWS_PER_BOARD,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QuickBuildInputError,
  type MarketObservationInput,
  type QuickBuildGameInput,
  type QuickBuildPresetName,
  type QuickBuildRequest,
  type QuickBuildResult,
} from '@/lib/quick-builds/types';

export const CURRENT_BOARD_QUICK_BUILD_LIMITATION =
  'Verified current stored snapshot for today\'s unstarted slate. It is not a live sportsbook feed.';

type SlateGame = QuickBuildGameInput & { status: string | null };

function limit(message: string): never {
  throw new QuickBuildInputError('LIMIT_EXCEEDED', message);
}

/**
 * Rows for the requested book on this game. Other books stay in the raw count
 * and never enter the 4,000-observation allowance.
 */
function relevantObservations(
  board: Extract<CurrentBoardResponse, { available: true }>,
  sportsbook: QuickBuildRequest['sportsbook']
): MarketObservationInput[] {
  return board.rows.flatMap((row) => {
    const book = canonicalizeSportsbook(row.sportsbook);
    if (!book || book.vendor !== sportsbook) return [];
    if (row.line == null || row.oddsAmerican == null) return [];
    return [{
      playerId: row.playerId,
      gameId: board.gameId,
      market: row.propType,
      side: row.side,
      line: row.line,
      sportsbook: book.vendor,
      oddsAmerican: row.oddsAmerican,
      pullRunId: String(board.snapshot.pullRunId),
      observedAt: board.observedAt,
      observationClock: 'RESPONSE_RECEIVED' as const,
    }];
  });
}

function presetRange(legCount: 2 | 3 | 4 | 5, preset: string): { minAmerican: number; maxAmerican: number } | null {
  if (legCount === 5) return QUICK_BUILD_FIVE_LEG_PRESETS[preset as keyof typeof QUICK_BUILD_FIVE_LEG_PRESETS] ?? null;
  if (legCount === 4) return QUICK_BUILD_FOUR_LEG_PRESETS[preset as keyof typeof QUICK_BUILD_FOUR_LEG_PRESETS] ?? null;
  if (legCount === 3) return QUICK_BUILD_THREE_LEG_PRESETS[preset as keyof typeof QUICK_BUILD_THREE_LEG_PRESETS] ?? null;
  return QUICK_BUILD_PRESETS[preset as QuickBuildPresetName] ?? null;
}

export async function buildCurrentQuickBuildRequest(args: {
  sportsbook: QuickBuildRequest['sportsbook'];
  preset: string;
  legCount?: 2 | 3 | 4 | 5;
  now: Date;
  games: readonly SlateGame[];
  store?: CurrentBoardStore;
}): Promise<QuickBuildRequest> {
  const store = args.store ?? defaultCurrentBoardStore();
  const legCount = args.legCount ?? 2;
  const range = presetRange(legCount, args.preset);
  if (!range) throw new Error('preset does not match the leg count');
  const asOf = args.now.toISOString();
  const attempts: QuickBuildRequest['attempts'] = [];
  const observations: MarketObservationInput[] = [];
  let rawRows = 0;
  for (const game of args.games) {
    const board = await readCurrentBoard({ store, gameId: game.gameId, now: asOf });
    if (!board.available || board.gameId !== game.gameId) continue;
    if (board.rows.length > QUICK_BUILD_MAX_RAW_ROWS_PER_BOARD) {
      limit(`raw board rows exceed ${QUICK_BUILD_MAX_RAW_ROWS_PER_BOARD}`);
    }
    rawRows += board.rows.length;
    if (rawRows > QUICK_BUILD_MAX_RAW_BOARD_ROWS) {
      limit(`raw board rows exceed ${QUICK_BUILD_MAX_RAW_BOARD_ROWS}`);
    }
    const rows = relevantObservations(board, args.sportsbook);
    if (observations.length + rows.length > QUICK_BUILD_MAX_OBSERVATIONS) {
      limit(`observations exceed ${QUICK_BUILD_MAX_OBSERVATIONS}`);
    }
    if (rows.length === 0) continue;
    attempts.push({
      pullRunId: String(board.snapshot.pullRunId),
      gameId: game.gameId,
      status: 'success',
      rowsStored: rows.length,
      completedAt: board.observedAt,
      observationClock: 'RESPONSE_RECEIVED',
    });
    observations.push(...rows);
  }
  return {
    sportsbook: args.sportsbook,
    range,
    policy: { mode: 'recently_observed', asOf, maxObservationAgeMs: BASE_SCHEDULE_FRESHNESS_MS },
    games: args.games.map((game) => ({ gameId: game.gameId, startTime: game.startTime, status: game.status })),
    attempts,
    observations,
    legCount,
  };
}

export async function loadCurrentQuickBuilds(args: {
  sportsbook: QuickBuildRequest['sportsbook'];
  preset: string;
  legCount?: 2 | 3 | 4 | 5;
  now: Date;
  games: readonly SlateGame[];
  store?: CurrentBoardStore;
  query?: QuickBuildReader;
}): Promise<QuickBuildApiBody> {
  const request = await buildCurrentQuickBuildRequest(args);
  const generated: QuickBuildResult = generateQuickBuilds(request);
  const { searchStats, ...result } = generated;
  void searchStats;
  let playerRows: PlayerNameRow[] = [];
  if (args.query && result.builds.length > 0) {
    const playerIds = [...new Set(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId)))];
    const rows = await args.query(QUICK_BUILD_PLAYERS_SQL, [playerIds]);
    playerRows = (Array.isArray(rows) ? rows : []).map((row) => {
      const record = row as { player_id?: unknown; full_name?: unknown; nba_player_id?: unknown };
      return {
        playerId: String(record.player_id ?? ''),
        fullName: typeof record.full_name === 'string' ? record.full_name : null,
        nbaPlayerId: record.nba_player_id == null ? null : String(record.nba_player_id),
      };
    });
  }
  const builds: QuickBuildDisplayed[] = attachQuickBuildDisplay({ builds: result.builds, games: request.games, playerRows });
  return {
    ...result,
    builds,
    generatedAt: request.policy.asOf,
    preset: args.preset as QuickBuildApiBody['preset'],
    snapshotClass: 'current_stored_snapshot',
    limitations: [CURRENT_BOARD_QUICK_BUILD_LIMITATION],
  };
}

export async function loadCurrentQuickBuildsFromSlate(args: {
  sportsbook: QuickBuildRequest['sportsbook'];
  preset: string;
  legCount?: 2 | 3 | 4 | 5;
  now: Date;
  query: QuickBuildReader;
  store?: CurrentBoardStore;
  gameIds?: readonly string[];
}): Promise<QuickBuildApiBody> {
  const asOf = args.now.toISOString();
  const rows = await args.query(QUICK_BUILD_GAMES_SQL, [args.now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), asOf]);
  const games: SlateGame[] = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const record = row as { game_id?: unknown; start_time?: unknown; status?: unknown };
    const gameId = record.game_id == null ? '' : String(record.game_id);
    const startTime = record.start_time instanceof Date ? record.start_time.toISOString() : typeof record.start_time === 'string' ? record.start_time : '';
    if (!gameId || !startTime) return [];
    if (args.gameIds && !args.gameIds.includes(gameId)) return [];
    return [{ gameId, startTime, status: typeof record.status === 'string' ? record.status : null }];
  });
  return loadCurrentQuickBuilds({ ...args, games });
}
