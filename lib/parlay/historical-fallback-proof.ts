/**
 * Temporary proof that the True Cost resolver fills one fixed archived leg
 * when its SQL quote list is empty. The leg is not taken from the request.
 * Remove this module with the admin route after the one production attempt.
 */
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { legsThatNeedArchive } from '@/lib/parlay/historical-board-quotes';
import { resolveParlayQuoteFallback } from '@/lib/parlay/resolve-parlay-quotes';
import { bestSingleBook, type BookLegQuote } from '@/lib/parlay/true-cost';
import { savedOfferTrueCostInput } from '@/lib/parlay/true-cost-presentation';
import type { TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import {
  HISTORICAL_BOARD_MANIFEST_SHA256,
  sha256,
  type HistoricalBoardObjectStore,
} from '@/lib/props/historical-board-archive';
import {
  shouldReadHistoricalBoard,
  type HistoricalBoardSource,
} from '@/lib/props/historical-board-config';
import { clearHistoricalBoardCache } from '@/lib/props/historical-board-read';

export const FALLBACK_SAVED_PRICE = -110;
const ARCHIVED_GAME = '21718091';
const ARCHIVED_PLAYER = '70';
const ARCHIVED_MARKET = 'assists';
const ARCHIVED_LINE = 3.5;
const OTHER_LINE = 13.5;
const SAVED_BOOK = 'betmgm';
const PROTECTED_GAME = '21718094';
const OPEN_GAME = '21718103';
const NOVEMBER_12_SHA = '9fa7157d0b25822ccd27097f75e1999e4ce98764d20f2baf4785f42c99898bfd';

const archivedLeg: TrueCostLegKey = {
  gameId: ARCHIVED_GAME,
  playerId: ARCHIVED_PLAYER,
  market: ARCHIVED_MARKET,
  side: 'over',
  line: ARCHIVED_LINE,
};
const otherLineLeg: TrueCostLegKey = { ...archivedLeg, line: OTHER_LINE };
const protectedLeg: TrueCostLegKey = {
  gameId: PROTECTED_GAME,
  playerId: '1',
  market: 'points',
  side: 'over',
  line: 20.5,
};
const openLeg: TrueCostLegKey = { ...protectedLeg, gameId: OPEN_GAME };

export const FALLBACK_FIXTURE_LEGS = [archivedLeg, otherLineLeg, protectedLeg, openLeg] as const;

export function emptyFallbackSqlQuotes(): BookLegQuote[][] {
  return FALLBACK_FIXTURE_LEGS.map(() => []);
}

export async function runHistoricalFallbackProof(args: {
  source: HistoricalBoardSource;
  store: HistoricalBoardObjectStore;
  todayEt: string;
}) {
  clearHistoricalBoardCache();
  const reads: Array<{ name: string; sha256: string; bytes: number }> = [];
  const recording: HistoricalBoardObjectStore = {
    async getObject(objectKey: string) {
      const bytes = await args.store.getObject(objectKey);
      if (bytes) {
        reads.push({
          name: objectKey.split('/').at(-1) ?? 'object',
          sha256: sha256(bytes),
          bytes: bytes.length,
        });
      }
      return bytes;
    },
  };
  const needed = legsThatNeedArchive(FALLBACK_FIXTURE_LEGS, emptyFallbackSqlQuotes());
  const resolved = await resolveParlayQuoteFallback({
    legs: FALLBACK_FIXTURE_LEGS,
    vendors: [SAVED_BOOK, null, null, null],
    bestBookEnabled: true,
    source: args.source,
    loadSqlQuotes: async () => emptyFallbackSqlQuotes(),
    store: recording,
  });
  const manifest = reads.find((read) => read.name === 'manifest.json');
  const partition = reads.find((read) => read.name === 'date=2026-11-12.json.gz');
  if (!manifest || manifest.sha256 !== HISTORICAL_BOARD_MANIFEST_SHA256) throw new Error('archive_checksum_mismatch');
  if (!partition || partition.sha256 !== NOVEMBER_12_SHA) throw new Error('archive_checksum_mismatch');
  const archivedQuotes = resolved.quotesPerLeg[0] ?? [];
  const savedBook = archivedQuotes.find((quote) => quote.vendor === SAVED_BOOK);
  const offered = savedOfferFor(archivedQuotes);
  const best = bestSingleBook({
    quotesPerLeg: [archivedQuotes],
    fairProbability: null,
    currentVendor: SAVED_BOOK,
    currentDecimal: null,
  });
  const bestVendor = best.status === 'known' ? best.best.vendor : null;
  return {
    cohortMember: needed.some((leg) => leg.gameId === ARCHIVED_GAME),
    sqlRowCount: resolved.sqlRowCount,
    quoteSource: resolved.quoteSource,
    objectsRead: reads.map((read) => read.name),
    manifestSha256: manifest.sha256,
    november12Sha256: partition.sha256,
    savedPriceAmerican: offered.priceAmerican,
    savedPriceUnchanged: offered.priceAmerican === FALLBACK_SAVED_PRICE,
    oppositePresent: offered.oppositeAmerican != null,
    oppositeAtSavedBook: savedBook?.oppositeAmerican != null,
    archivedQuoteCount: archivedQuotes.length,
    otherLineQuoteCount: resolved.quotesPerLeg[1]?.length ?? 0,
    protectedQuoteCount: resolved.quotesPerLeg[2]?.length ?? 0,
    openQuoteCount: resolved.quotesPerLeg[3]?.length ?? 0,
    bestBookStatus: best.status,
    bestBookFromArchivedQuotes: bestVendor != null && archivedQuotes.some((quote) => quote.vendor === bestVendor),
    researchCloseUsed: false,
    todayReadsArchive: shouldReadHistoricalBoard(args.source, args.todayEt, args.todayEt),
    protectedOrOpenRequestedArchive: needed.some((leg) => leg.gameId === PROTECTED_GAME || leg.gameId === OPEN_GAME),
  };
}

function savedOfferFor(quotes: BookLegQuote[]) {
  const adapted = adaptPropsExplorerOffer({
    playerId: ARCHIVED_PLAYER,
    playerName: 'archived',
    gameId: ARCHIVED_GAME,
    propType: ARCHIVED_MARKET,
    side: 'over',
    lineValue: ARCHIVED_LINE,
    sportsbook: 'BetMGM',
    oddsAmerican: FALLBACK_SAVED_PRICE,
    snapshotAt: '2026-11-12T00:00:00.000Z',
    marketContext: 'historical',
    sourceTable: 'analytics.player_props_current',
  });
  if (!adapted.ok) throw new Error('archive_unreadable');
  return savedOfferTrueCostInput({ offer: adapted.offer, gameLabel: 'archived' }, quotes);
}
