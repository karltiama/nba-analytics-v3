/**
 * Optional local-archive read for a past Last-5 date. Current dates and an
 * unset directory stay on the SQL board. A missing or corrupt partition is
 * an error. Research closes are not consulted.
 */
import { query } from '@/lib/db';
import { shouldReadHistoricalBoard, type HistoricalBoardSource } from '@/lib/props/historical-board-config';
import { type HistoricalBoardObjectStore } from '@/lib/props/historical-board-archive';
import { localHistoricalBoardStore, archivedGameIdsForDate } from '@/lib/props/historical-board-store';
import { openHistoricalBoardS3Store } from '@/lib/props/historical-board-s3';
import { loadHistoricalBoardDate, loadHistoricalBoardManifest } from '@/lib/props/historical-board-read';
import { playersFromArchiveRows, selectLast5Players, type Last5PlayerContext } from './historical-board';
import type { TonightPropPlayer } from './queries';

type ContextRow = {
  player_id: string;
  full_name: string;
  game_id: string;
  start_time: string;
  team_abbr: string | null;
  home_abbr: string;
  away_abbr: string;
  is_home: boolean | null;
  injured: boolean;
};

async function loadLast5PlayerContext(
  pairs: Array<{ gameId: number; playerId: number }>
): Promise<Map<string, Last5PlayerContext>> {
  const context = new Map<string, Last5PlayerContext>();
  if (pairs.length === 0) return context;
  const rows = await query<ContextRow>(
    `WITH wanted(game_id, player_id) AS (
       SELECT * FROM unnest($1::text[], $2::text[])
     ),
     team_of AS (
       SELECT DISTINCT ON (pgl.player_id) pgl.player_id, pgl.team_id
       FROM analytics.player_game_logs pgl
       WHERE pgl.player_id IN (SELECT player_id FROM wanted)
       ORDER BY pgl.player_id, pgl.game_date DESC
     )
     SELECT w.player_id, pl.full_name, w.game_id, g.start_time::text AS start_time,
            pt.abbreviation AS team_abbr, ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
            CASE WHEN tof.team_id IS NULL THEN NULL ELSE tof.team_id = g.home_team_id END AS is_home,
            EXISTS (
              SELECT 1 FROM analytics.player_injury_status_current i
              WHERE i.player_id = w.player_id
                AND (LOWER(COALESCE(i.status, '')) LIKE 'out%' OR LOWER(COALESCE(i.status, '')) LIKE 'doubtful%')
            ) AS injured
       FROM wanted w
       JOIN analytics.games g ON g.game_id = w.game_id
       JOIN analytics.players pl ON pl.player_id = w.player_id
       JOIN analytics.teams ht ON ht.team_id = g.home_team_id
       JOIN analytics.teams at ON at.team_id = g.away_team_id
       LEFT JOIN team_of tof ON tof.player_id = w.player_id
       LEFT JOIN analytics.teams pt ON pt.team_id = tof.team_id`,
    [pairs.map((pair) => String(pair.gameId)), pairs.map((pair) => String(pair.playerId))]
  );
  for (const row of rows) {
    context.set(`${row.game_id}|${row.player_id}`, {
      playerId: row.player_id,
      playerName: row.full_name,
      gameId: row.game_id,
      teamAbbr: row.team_abbr,
      homeAbbr: row.home_abbr,
      awayAbbr: row.away_abbr,
      isHome: row.is_home,
      startTime: row.start_time,
      injured: row.injured,
    });
  }
  return context;
}

function cacheKey(source: Exclude<HistoricalBoardSource, { mode: 'off' }>): string {
  return source.mode === 'local' ? `local:${source.directory}` : `s3:${source.bucket}`;
}

function openStore(source: Exclude<HistoricalBoardSource, { mode: 'off' }>): HistoricalBoardObjectStore {
  return source.mode === 'local' ? localHistoricalBoardStore(source.directory) : openHistoricalBoardS3Store();
}

export async function applyHistoricalBoard(args: {
  date: string;
  todayEt: string;
  market: string;
  sqlPlayers: TonightPropPlayer[];
  source: HistoricalBoardSource;
  store?: HistoricalBoardObjectStore;
}): Promise<TonightPropPlayer[]> {
  if (args.source.mode === 'off' || !shouldReadHistoricalBoard(args.source, args.date, args.todayEt)) {
    return selectLast5Players({
      date: args.date,
      todayEt: args.todayEt,
      sqlPlayers: args.sqlPlayers,
      archivePlayers: null,
      archivedGameIds: new Set(),
    });
  }
  const store = args.store ?? openStore(args.source);
  const manifest = await loadHistoricalBoardManifest(store, cacheKey(args.source));
  if (!manifest.partitions.some((partition) => partition.id === args.date)) return args.sqlPlayers;
  const rows = await loadHistoricalBoardDate(store, manifest, args.date, cacheKey(args.source));
  const pairs = new Map<string, { gameId: number; playerId: number }>();
  for (const row of rows) {
    if (row.propType !== args.market || row.marketType !== 'over_under') continue;
    pairs.set(`${row.gameId}|${row.playerId}`, { gameId: row.gameId, playerId: row.playerId });
  }
  const context = await loadLast5PlayerContext([...pairs.values()]);
  return selectLast5Players({
    date: args.date,
    todayEt: args.todayEt,
    sqlPlayers: args.sqlPlayers,
    archivePlayers: playersFromArchiveRows(rows, args.market, context),
    archivedGameIds: archivedGameIdsForDate(manifest, args.date),
  });
}
