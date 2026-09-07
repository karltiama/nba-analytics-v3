/**
 * Shared Props Explorer query: live current table vs historical closing/decision lines.
 * Does not write to analytics.player_props_current.
 */

import { query, queryOne } from '@/lib/db';
import { getPlayerPropModelInputs, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { computePropEvFields, type PropEvFields } from '@/lib/betting/player-prop-ev-row';
import {
  etCalendarDate,
  etCalendarDateFromInstant,
  isActivePaperBetAllowed,
  propsLineLabel,
  propsServingSource,
  resolvePropsMarketContext,
  type PropsMarketContext,
  type PropsServingSource,
} from '@/lib/betting/props-market-context';

export type PropsExplorerDbRow = {
  game_id: string | number;
  player_id: number | string;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  odds_decimal: string | number | null;
  implied_probability: string | number | null;
  snapshot_at: string | Date;
  game_start_time: string | Date | null;
};

const COMPUTED_SORTS = new Set(['ev', 'ev_track_a', 'ev_track_b', 'confidence']);
export const PROPS_EXPLORER_MAX_LIMIT = 200;
export const PROPS_EXPLORER_EV_FETCH_CAP = 2500;

function impliedProbFromAmerican(oddsAmerican: number | null): number | null {
  if (oddsAmerican == null || Number.isNaN(oddsAmerican) || oddsAmerican === 0) return null;
  if (oddsAmerican < 0) return (-oddsAmerican) / ((-oddsAmerican) + 100);
  return 100 / (oddsAmerican + 100);
}

function unavailableEvPatch(): Pick<
  PropEvFields,
  'modelProbability' | 'ev' | 'projection' | 'confidenceTier' | 'evTrackA' | 'evTrackB'
> {
  return {
    modelProbability: null,
    ev: null,
    projection: null,
    confidenceTier: null,
    evTrackA: null,
    evTrackB: null,
  };
}

export function buildPropsExplorerWhere(sp: {
  gameId: string;
  dateEt: string;
  playerName: string;
  propType: string;
  side: string;
  sportsbook: string;
  marketType: string;
}): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (sp.gameId) {
    conditions.push(`p.game_id::text = $${i++}`);
    params.push(sp.gameId);
  } else {
    conditions.push(`g.start_time >= ($${i}::timestamp AT TIME ZONE 'America/New_York')`);
    conditions.push(`g.start_time < (($${i}::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`);
    params.push(sp.dateEt);
    i++;
  }

  if (sp.playerName) {
    conditions.push(`COALESCE(p.player_name, pl.full_name) ILIKE $${i++}`);
    params.push(`%${sp.playerName}%`);
  }

  if (sp.propType) {
    const pattern = sp.propType.includes('%') ? sp.propType : `${sp.propType}%`;
    conditions.push(`p.prop_type ILIKE $${i++}`);
    params.push(pattern);
  }

  if (sp.side && sp.side !== 'all') {
    conditions.push(`lower(p.side) = lower($${i++})`);
    params.push(sp.side);
  }

  if (sp.sportsbook) {
    const books = sp.sportsbook.split(',').filter(Boolean).map((b) => b.toLowerCase());
    if (books.length > 0) {
      conditions.push(`lower(trim(p.sportsbook)) = ANY($${i++})`);
      params.push(books);
    }
  }

  if (sp.marketType && sp.marketType !== 'all') {
    conditions.push(`lower(p.market_type) = lower($${i++})`);
    params.push(sp.marketType);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function fromJoin(context: PropsMarketContext, whereSql: string): string {
  if (context === 'historical') {
    return `
      FROM research.prop_decision_lines p
      INNER JOIN analytics.games g ON g.game_id = p.game_id
      LEFT JOIN analytics.players pl ON pl.player_id = p.player_id
      ${whereSql}
    `;
  }
  return `
      FROM analytics.player_props_current p
      INNER JOIN analytics.games g ON g.game_id = p.game_id::text
      LEFT JOIN analytics.players pl ON pl.player_id = p.player_id::text
      ${whereSql}
    `;
}

function selectList(context: PropsMarketContext): string {
  const observed =
    context === 'historical' ? 'p.decision_at AS snapshot_at' : 'p.snapshot_at';
  return `SELECT p.game_id, p.player_id, COALESCE(p.player_name, pl.full_name) AS player_name, p.sportsbook, p.prop_type, p.market_type, p.side,
                p.line_value, p.odds_american, p.odds_decimal, p.implied_probability, ${observed},
                g.start_time AS game_start_time`;
}

async function loadInputsForPlayers(playerIds: number[]): Promise<Map<number, PlayerPropModelInputs | null>> {
  const map = new Map<number, PlayerPropModelInputs | null>();
  const unique = [...new Set(playerIds)];
  const chunkSize = 12;
  for (let c = 0; c < unique.length; c += chunkSize) {
    const chunk = unique.slice(c, c + chunkSize);
    await Promise.all(
      chunk.map(async (id) => {
        try {
          const inputs = await getPlayerPropModelInputs(String(id));
          map.set(id, inputs);
        } catch {
          map.set(id, null);
        }
      })
    );
  }
  return map;
}

function sortKey(
  row: {
    ev: number | null;
    evTrackA: number | null;
    evTrackB: number | null;
    confidenceTier?: string | null;
    snapshotAt: string;
  },
  sort: string
): number {
  if (sort === 'ev' || sort === 'ev_track_a' || sort === 'ev_track_b') {
    const v =
      sort === 'ev_track_a' ? row.evTrackA : sort === 'ev_track_b' ? row.evTrackB : row.ev;
    return v == null || !Number.isFinite(v) ? Number.NEGATIVE_INFINITY : v;
  }
  if (sort === 'confidence') {
    const t = row.confidenceTier;
    return t === 'high' ? 3 : t === 'medium' ? 2 : t === 'low' ? 1 : 0;
  }
  return new Date(row.snapshotAt).getTime();
}

export type PropsExplorerRow = {
  gameId: string | number;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
  snapshotAt: string;
  marketContext: PropsMarketContext;
  lineLabel: string;
  paperBetAllowed: boolean;
  sourceTable: PropsServingSource;
} & Partial<PropEvFields> & {
    evSelectedTrack?: string;
    calibrationVersion?: string;
  };

export type GetPlayerPropsForExplorerInput = {
  dateEt: string;
  gameId?: string;
  playerName?: string;
  propType?: string;
  side?: string;
  sportsbook?: string;
  marketType?: string;
  sort?: string;
  dirAsc?: boolean;
  limit: number;
  offset: number;
  minEv?: number | null;
  todayEt?: string;
  now?: Date;
};

export async function getPlayerPropsForExplorer(
  input: GetPlayerPropsForExplorerInput
): Promise<{
  rows: PropsExplorerRow[];
  totalMatching: number;
  marketContext: PropsMarketContext;
  sourceTable: PropsServingSource;
  lineLabel: string;
  dateEt: string;
  evSelectedTrack: string;
  calibrationVersion: string | null;
  evFetchCap: number | null;
  sort: string;
}> {
  const todayEt = input.todayEt ?? etCalendarDate(input.now);
  let dateEt = input.dateEt;
  const gameId = (input.gameId ?? '').trim();

  if (gameId) {
    const game = await queryOne<{ start_time: string | Date }>(
      `SELECT start_time FROM analytics.games WHERE game_id = $1`,
      [gameId]
    );
    const fromGame = etCalendarDateFromInstant(game?.start_time ?? null);
    if (fromGame) dateEt = fromGame;
  }

  const marketContext = resolvePropsMarketContext({ dateEt, todayEt });
  const sourceTable = propsServingSource(marketContext);
  const lineLabel = propsLineLabel(marketContext);
  const selectedTrack = resolveEvTrack();

  const { sql: whereSql, params: whereParams } = buildPropsExplorerWhere({
    gameId,
    dateEt,
    playerName: (input.playerName ?? '').trim(),
    propType: (input.propType ?? '').trim(),
    side: (input.side || 'all').toLowerCase(),
    sportsbook: (input.sportsbook ?? '').trim(),
    marketType: (input.marketType || 'over_under').trim().toLowerCase(),
  });

  const join = fromJoin(marketContext, whereSql);
  const countResult = await query<{ count: string }>(
    `SELECT count(*)::text AS count ${join}`,
    whereParams
  );
  const totalMatching = parseInt(countResult[0]?.count ?? '0', 10) || 0;

  const sortRaw = (input.sort || 'snapshot_at').toLowerCase();
  const sort = sortRaw === 'edge' ? 'snapshot_at' : sortRaw;
  const dirAsc = Boolean(input.dirAsc);
  const observedCol = marketContext === 'historical' ? 'p.decision_at' : 'p.snapshot_at';
  const useComputedSort = marketContext === 'live' && COMPUTED_SORTS.has(sort);
  const orderSqlCol =
    sort === 'odds_american'
      ? 'p.odds_american'
      : useComputedSort
        ? observedCol
        : sort === 'snapshot_at' || !COMPUTED_SORTS.has(sort)
          ? observedCol
          : observedCol;
  const orderDir = dirAsc ? 'ASC' : 'DESC';

  let dbRows: PropsExplorerDbRow[];
  if (useComputedSort) {
    const fetchParams = [...whereParams, PROPS_EXPLORER_EV_FETCH_CAP];
    const limIdx = whereParams.length + 1;
    dbRows = await query<PropsExplorerDbRow>(
      `${selectList(marketContext)} ${join}
       ORDER BY ${observedCol} DESC NULLS LAST
       LIMIT $${limIdx}`,
      fetchParams
    );
  } else {
    const fetchParams = [...whereParams, input.limit, input.offset];
    const limIdx = whereParams.length + 1;
    const offIdx = whereParams.length + 2;
    dbRows = await query<PropsExplorerDbRow>(
      `${selectList(marketContext)} ${join}
       ORDER BY ${orderSqlCol} ${orderDir} NULLS LAST
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      fetchParams
    );
  }

  let inputsByPlayer = new Map<number, PlayerPropModelInputs | null>();
  if (marketContext === 'live') {
    const uniquePlayers = [
      ...new Set(dbRows.map((r) => Number(r.player_id)).filter((id) => Number.isFinite(id))),
    ];
    inputsByPlayer = await loadInputsForPlayers(uniquePlayers);
  }

  const cal = marketContext === 'live' ? getCalibrationVersion() : null;
  const now = input.now ?? new Date();

  const rows: PropsExplorerRow[] = dbRows.map((r) => {
    const offerP =
      r.implied_probability != null
        ? Number(r.implied_probability)
        : impliedProbFromAmerican(r.odds_american);
    const playerId = Number(r.player_id);
    const evFields =
      marketContext === 'live'
        ? computePropEvFields(
            {
              prop_type: r.prop_type,
              market_type: r.market_type,
              side: r.side,
              line_value: r.line_value != null ? Number(r.line_value) : null,
              odds_american: r.odds_american,
              odds_decimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
            },
            inputsByPlayer.get(playerId) ?? null,
            selectedTrack
          )
        : unavailableEvPatch();

    const snapshotAt =
      r.snapshot_at instanceof Date ? r.snapshot_at.toISOString() : String(r.snapshot_at);

    return {
      gameId: r.game_id,
      playerId,
      playerName: r.player_name ?? null,
      sportsbook: r.sportsbook ?? null,
      propType: r.prop_type ?? null,
      marketType: r.market_type ?? null,
      side: r.side ?? null,
      lineValue: r.line_value != null ? Number(r.line_value) : null,
      oddsAmerican: r.odds_american ?? null,
      oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
      impliedProbability: offerP != null && Number.isFinite(offerP) ? offerP : null,
      snapshotAt,
      marketContext,
      lineLabel,
      paperBetAllowed:
        marketContext === 'live' &&
        isActivePaperBetAllowed({ gameStartTime: r.game_start_time, now }),
      sourceTable,
      ...evFields,
      evSelectedTrack: selectedTrack,
      calibrationVersion: cal ?? undefined,
    };
  });

  let outRows = rows;
  const minEv = input.minEv;
  if (marketContext === 'live' && minEv != null && Number.isFinite(minEv)) {
    outRows = outRows.filter((r) => r.ev != null && Number.isFinite(r.ev) && r.ev >= minEv);
  }

  if (useComputedSort) {
    outRows = [...outRows].sort((a, b) => {
      const ka = sortKey(a, sort);
      const kb = sortKey(b, sort);
      const cmp = ka - kb;
      return dirAsc ? cmp : -cmp;
    });
    outRows = outRows.slice(input.offset, input.offset + input.limit);
  }

  return {
    rows: outRows,
    totalMatching,
    marketContext,
    sourceTable,
    lineLabel,
    dateEt,
    evSelectedTrack: selectedTrack,
    calibrationVersion: cal,
    evFetchCap: useComputedSort ? PROPS_EXPLORER_EV_FETCH_CAP : null,
    sort,
  };
}
