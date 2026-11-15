/**
 * True Cost quotes from the historical board. SQL quotes stay in place.
 * An archived game with no SQL quote reads one date partition. The saved
 * offered price is not an input to this function.
 */
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import type { TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import frozenBoard from '@/lib/props/current-board-reclamation-manifest.json';
import {
  type HistoricalBoardSource,
} from '@/lib/props/historical-board-config';
import { localHistoricalBoardStore } from '@/lib/props/historical-board-store';
import { openHistoricalBoardS3Store } from '@/lib/props/historical-board-s3';
import {
  quotesFromHistoricalBoard,
  type HistoricalBoardArchiveManifest,
  type HistoricalBoardObjectStore,
} from '@/lib/props/historical-board-archive';
import { loadHistoricalBoardDate, loadHistoricalBoardManifest } from '@/lib/props/historical-board-read';

const ARCHIVED_GAME_IDS = new Set(frozenBoard.games.map((game) => String(game.gameId)));

export function legsThatNeedArchive(
  legs: readonly TrueCostLegKey[],
  sqlQuotes: readonly BookLegQuote[][]
): TrueCostLegKey[] {
  return legs.filter((leg, index) => (sqlQuotes[index]?.length ?? 0) === 0 && ARCHIVED_GAME_IDS.has(leg.gameId));
}

function cacheKey(source: Exclude<HistoricalBoardSource, { mode: 'off' }>): string {
  return source.mode === 'local' ? `local:${source.directory}` : `s3:${source.bucket}`;
}

function openStore(source: Exclude<HistoricalBoardSource, { mode: 'off' }>): HistoricalBoardObjectStore {
  return source.mode === 'local' ? localHistoricalBoardStore(source.directory) : openHistoricalBoardS3Store();
}

export async function quotesFromValidatedManifest(args: {
  store: HistoricalBoardObjectStore;
  manifest: HistoricalBoardArchiveManifest;
  legs: readonly TrueCostLegKey[];
  cacheKey: string;
}): Promise<BookLegQuote[][]> {
  const dateByGame = new Map(args.manifest.games.map((game) => [String(game.gameId), game.dateEt]));
  const dates = [...new Set(args.legs.map((leg) => dateByGame.get(leg.gameId)).filter((date): date is string => date != null))];
  const rowsByDate = new Map<string, Awaited<ReturnType<typeof loadHistoricalBoardDate>>>();
  for (const dateEt of dates) {
    rowsByDate.set(dateEt, await loadHistoricalBoardDate(args.store, args.manifest, dateEt, args.cacheKey));
  }
  return args.legs.map((leg) => {
    const dateEt = dateByGame.get(leg.gameId);
    if (!dateEt) throw new Error('archive_game_missing');
    return quotesFromHistoricalBoard(rowsByDate.get(dateEt) ?? [], [leg])[0] ?? [];
  });
}

/**
 * Returns one quote list per input leg. SQL-backed legs and games outside
 * the frozen 95 are returned empty here so the caller keeps the SQL result.
 * Archive failures throw. They do not become an empty quote.
 */
export async function archiveQuotesForEmptyLegs(
  source: HistoricalBoardSource,
  legs: readonly TrueCostLegKey[],
  sqlQuotes: readonly BookLegQuote[][],
  store?: HistoricalBoardObjectStore
): Promise<BookLegQuote[][]> {
  const empty = legs.map(() => [] as BookLegQuote[]);
  if (source.mode === 'off') return empty;
  const needed = legsThatNeedArchive(legs, sqlQuotes);
  if (needed.length === 0) return empty;
  const resolved = store ?? openStore(source);
  const manifest = await loadHistoricalBoardManifest(resolved, cacheKey(source));
  const filled = await quotesFromValidatedManifest({
    store: resolved,
    manifest,
    legs: needed,
    cacheKey: cacheKey(source),
  });
  const byId = new Map(needed.map((leg, index) => [`${leg.gameId}|${leg.playerId}|${leg.market}|${leg.line}|${leg.side}`, filled[index] ?? []]));
  return legs.map((leg, index) => {
    if ((sqlQuotes[index]?.length ?? 0) > 0 || !ARCHIVED_GAME_IDS.has(leg.gameId)) return [];
    return byId.get(`${leg.gameId}|${leg.playerId}|${leg.market}|${leg.line}|${leg.side}`) ?? [];
  });
}
