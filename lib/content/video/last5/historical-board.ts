/**
 * Historical Last-5 players from the archived board. Current dates never
 * reach this merge. Research closes are not an input.
 */
import type { HistoricalBoardRow } from '@/lib/props/historical-board-archive';
import type { BookLineQuote } from './snapshot';
import type { TonightPropPlayer } from './queries';

export type Last5PlayerContext = {
  playerId: string;
  playerName: string;
  gameId: string;
  teamAbbr: string | null;
  homeAbbr: string;
  awayAbbr: string;
  isHome: boolean | null;
  startTime: string;
  injured: boolean;
};

function numberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quoteSignature(quotes: readonly BookLineQuote[]): string {
  return JSON.stringify(
    [...quotes]
      .map((quote) => [quote.sportsbook, quote.side, quote.line, quote.impliedProbability])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  );
}

export function playersFromArchiveRows(
  rows: readonly HistoricalBoardRow[],
  market: string,
  contextByPlayer: ReadonlyMap<string, Last5PlayerContext>
): TonightPropPlayer[] {
  const matching = rows.filter((row) =>
    row.propType === market
    && row.marketType === 'over_under'
    && (row.side === 'over' || row.side === 'under')
  );
  const latest = new Map<string, string>();
  for (const row of matching) {
    const key = `${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`;
    const current = latest.get(key);
    if (current == null || BigInt(row.snapshotMicros) > BigInt(current)) latest.set(key, row.snapshotMicros);
  }
  const players = new Map<string, TonightPropPlayer>();
  for (const row of matching) {
    if (latest.get(`${row.gameId}|${row.playerId}|${row.sportsbook ?? ''}`) !== row.snapshotMicros) continue;
    if (row.side !== 'over' && row.side !== 'under') continue;
    const context = contextByPlayer.get(`${row.gameId}|${row.playerId}`);
    if (!context || context.injured || context.isHome == null || !context.teamAbbr) continue;
    const key = `${row.gameId}|${row.playerId}`;
    let player = players.get(key);
    if (!player) {
      player = {
        playerId: String(row.playerId),
        playerName: context.playerName,
        gameId: String(row.gameId),
        teamAbbr: context.teamAbbr,
        opponentAbbr: context.isHome ? context.awayAbbr : context.homeAbbr,
        isHome: context.isHome,
        startTime: context.startTime,
        quotes: [],
        linesAsOf: row.snapshotAt,
      };
      players.set(key, player);
    }
    player.quotes.push({
      sportsbook: row.sportsbook ?? '',
      side: row.side,
      line: numberOrNull(row.lineText) ?? Number.NaN,
      impliedProbability: numberOrNull(row.impliedText),
    });
    if (row.snapshotAt > player.linesAsOf) player.linesAsOf = row.snapshotAt;
  }
  return [...players.values()];
}

function byGame(players: readonly TonightPropPlayer[]): Map<string, TonightPropPlayer[]> {
  const games = new Map<string, TonightPropPlayer[]>();
  for (const player of players) {
    const list = games.get(player.gameId) ?? [];
    list.push(player);
    games.set(player.gameId, list);
  }
  return games;
}

function sameGame(sql: readonly TonightPropPlayer[], archive: readonly TonightPropPlayer[]): boolean {
  if (sql.length !== archive.length) return false;
  const archiveByPlayer = new Map(archive.map((player) => [player.playerId, player]));
  return sql.every((player) => {
    const other = archiveByPlayer.get(player.playerId);
    return other != null && quoteSignature(player.quotes) === quoteSignature(other.quotes);
  });
}

/**
 * Archived games come from the archive. Protected games on the same date stay
 * on the SQL board. A game present in both must carry the same quotes.
 */
export function mergeLast5Players(input: {
  sqlPlayers: readonly TonightPropPlayer[];
  archivePlayers: readonly TonightPropPlayer[];
  archivedGameIds: ReadonlySet<string>;
}): TonightPropPlayer[] {
  const sqlGames = byGame(input.sqlPlayers);
  const archiveGames = byGame(input.archivePlayers);
  const gameIds = [...new Set([...sqlGames.keys(), ...archiveGames.keys()])].sort();
  const merged: TonightPropPlayer[] = [];
  for (const gameId of gameIds) {
    const sql = sqlGames.get(gameId) ?? [];
    const archive = archiveGames.get(gameId) ?? [];
    if (input.archivedGameIds.has(gameId)) {
      if (archive.length === 0) throw new Error('archive_game_missing');
      if (sql.length > 0 && !sameGame(sql, archive)) throw new Error('archive_sql_conflict');
      merged.push(...archive);
      continue;
    }
    if (archive.length > 0) throw new Error('archive_sql_conflict');
    merged.push(...sql);
  }
  return merged;
}

/** Current dates ignore the archive. An unconfigured archive leaves SQL as it is. */
export function selectLast5Players(input: {
  date: string;
  todayEt: string;
  sqlPlayers: TonightPropPlayer[];
  archivePlayers: TonightPropPlayer[] | null;
  archivedGameIds: ReadonlySet<string>;
}): TonightPropPlayer[] {
  if (input.date >= input.todayEt || input.archivePlayers == null) return input.sqlPlayers;
  return mergeLast5Players({
    sqlPlayers: input.sqlPlayers,
    archivePlayers: input.archivePlayers,
    archivedGameIds: input.archivedGameIds,
  });
}
