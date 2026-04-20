import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPlayerPropModelInputs, type PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { computePropEvFields } from '@/lib/betting/player-prop-ev-row';

type DbRow = {
  game_id: number;
  player_id: number;
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
};

const COMPUTED_SORTS = new Set(['ev', 'ev_track_a', 'ev_track_b', 'confidence']);
const MAX_LIMIT = 200;
const EV_FETCH_CAP = 2500;

function impliedProbFromAmerican(oddsAmerican: number | null): number | null {
  if (oddsAmerican == null || Number.isNaN(oddsAmerican) || oddsAmerican === 0) return null;
  if (oddsAmerican < 0) return (-oddsAmerican) / ((-oddsAmerican) + 100);
  return 100 / (oddsAmerican + 100);
}

function buildWhereClause(sp: URLSearchParams): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const gameIdParam = sp.get('game_id');
  const gameId = gameIdParam != null ? parseInt(gameIdParam, 10) : NaN;
  const date =
    sp.get('date')?.trim() ||
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  if (Number.isFinite(gameId)) {
    conditions.push(`p.game_id = $${i++}`);
    params.push(gameId);
  } else {
    conditions.push(`g.start_time >= ($${i}::timestamp AT TIME ZONE 'America/New_York')`);
    conditions.push(`g.start_time < (($${i}::timestamp + interval '1 day') AT TIME ZONE 'America/New_York')`);
    params.push(date);
    i++;
  }

  const playerName = sp.get('player_name')?.trim();
  if (playerName) {
    conditions.push(`COALESCE(p.player_name, pl.full_name) ILIKE $${i++}`);
    params.push(`%${playerName}%`);
  }

  const propType = sp.get('prop_type')?.trim();
  if (propType) {
    const pattern = propType.includes('%') ? propType : `${propType}%`;
    conditions.push(`p.prop_type ILIKE $${i++}`);
    params.push(pattern);
  }

  const side = (sp.get('side') || 'all').toLowerCase();
  if (side !== 'all') {
    conditions.push(`lower(p.side) = lower($${i++})`);
    params.push(side);
  }

  const sportsbookParam = sp.get('sportsbook')?.trim();
  if (sportsbookParam) {
    const books = sportsbookParam.split(',').filter(Boolean).map((b) => b.toLowerCase());
    if (books.length > 0) {
      conditions.push(`lower(trim(p.sportsbook)) = ANY($${i++})`);
      params.push(books);
    }
  }

  const marketType = (sp.get('market_type') || 'over_under').trim().toLowerCase();
  if (marketType && marketType !== 'all') {
    conditions.push(`lower(p.market_type) = lower($${i++})`);
    params.push(marketType);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
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
    confidenceTier?: 'high' | 'medium' | 'low' | null;
    snapshotAt: string;
    oddsAmerican: number | null;
  },
  sort: string
): number {
  switch (sort) {
    case 'ev':
      return row.ev != null && Number.isFinite(row.ev) ? row.ev : Number.NEGATIVE_INFINITY;
    case 'ev_track_a':
      return row.evTrackA != null && Number.isFinite(row.evTrackA) ? row.evTrackA : Number.NEGATIVE_INFINITY;
    case 'ev_track_b':
      return row.evTrackB != null && Number.isFinite(row.evTrackB) ? row.evTrackB : Number.NEGATIVE_INFINITY;
    case 'confidence': {
      const rank =
        row.confidenceTier === 'high'
          ? 3
          : row.confidenceTier === 'medium'
            ? 2
            : row.confidenceTier === 'low'
              ? 1
              : Number.NEGATIVE_INFINITY;
      return rank;
    }
    case 'odds_american':
      return row.oddsAmerican != null && Number.isFinite(row.oddsAmerican) ? row.oddsAmerican : Number.NEGATIVE_INFINITY;
    case 'snapshot_at':
    default:
      return new Date(row.snapshotAt).getTime();
  }
}


/**
 * GET /api/betting/props-explorer
 *
 * Paginated props from analytics.player_props_current with optional date (ET) or game_id,
 * plus EV fields (Track B primary via resolveEvTrack; Track A/B diagnostics).
 */
export async function GET(request: NextRequest) {
  try {
    const selectedTrack = resolveEvTrack();
    const sp = request.nextUrl.searchParams;
    const { sql: whereSql, params: whereParams } = buildWhereClause(sp);

    let limit = parseInt(sp.get('limit') || '100', 10);
    let offset = parseInt(sp.get('offset') || '0', 10);
    if (Number.isNaN(limit)) limit = 100;
    if (Number.isNaN(offset)) offset = 0;
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    offset = Math.max(offset, 0);

    const sortRaw = (sp.get('sort') || 'snapshot_at').toLowerCase();
    const sort = sortRaw === 'edge' ? 'snapshot_at' : sortRaw;
    const dirAsc = sp.get('dir') === 'asc';

    const minEvParam = sp.get('min_ev');
    const minEv =
      minEvParam != null && minEvParam !== '' && !Number.isNaN(parseFloat(minEvParam))
        ? parseFloat(minEvParam)
        : null;

    const fromJoin = `
      FROM analytics.player_props_current p
      INNER JOIN analytics.games g ON g.game_id = p.game_id::text
      LEFT JOIN analytics.players pl ON pl.player_id = p.player_id::text
      ${whereSql}
    `;

    const countResult = await query<{ count: string }>(
      `SELECT count(*)::text AS count ${fromJoin}`,
      whereParams
    );
    const totalMatching = parseInt(countResult[0]?.count ?? '0', 10) || 0;

    const orderSqlCol =
      sort === 'odds_american'
        ? 'p.odds_american'
        : sort === 'snapshot_at' || !COMPUTED_SORTS.has(sort)
          ? 'p.snapshot_at'
          : 'p.snapshot_at';
    const orderDir = dirAsc ? 'ASC' : 'DESC';

    let dbRows: DbRow[];

    if (COMPUTED_SORTS.has(sort)) {
      const fetchParams = [...whereParams, EV_FETCH_CAP];
      const limIdx = whereParams.length + 1;
      dbRows = await query<DbRow>(
        `SELECT p.game_id, p.player_id, COALESCE(p.player_name, pl.full_name) AS player_name, p.sportsbook, p.prop_type, p.market_type, p.side,
                p.line_value, p.odds_american, p.odds_decimal, p.implied_probability, p.snapshot_at
         ${fromJoin}
         ORDER BY p.snapshot_at DESC NULLS LAST
         LIMIT $${limIdx}`,
        fetchParams
      );
    } else {
      const fetchParams = [...whereParams, limit, offset];
      const limIdx = whereParams.length + 1;
      const offIdx = whereParams.length + 2;
      dbRows = await query<DbRow>(
        `SELECT p.game_id, p.player_id, COALESCE(p.player_name, pl.full_name) AS player_name, p.sportsbook, p.prop_type, p.market_type, p.side,
                p.line_value, p.odds_american, p.odds_decimal, p.implied_probability, p.snapshot_at
         ${fromJoin}
         ORDER BY ${orderSqlCol} ${orderDir} NULLS LAST
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        fetchParams
      );
    }

    const uniquePlayers = [...new Set(dbRows.map((r) => r.player_id))];
    const inputsByPlayer = await loadInputsForPlayers(uniquePlayers);

    const rows = dbRows.map((r) => {
      const offerP =
        r.implied_probability != null
          ? Number(r.implied_probability)
          : impliedProbFromAmerican(r.odds_american);
      const modelInputs = inputsByPlayer.get(r.player_id) ?? null;
      const evFields = computePropEvFields(
        {
          prop_type: r.prop_type,
          market_type: r.market_type,
          side: r.side,
          line_value: r.line_value != null ? Number(r.line_value) : null,
          odds_american: r.odds_american,
          odds_decimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
        },
        modelInputs,
        selectedTrack
      );

      const cal = getCalibrationVersion();
      return {
        gameId: r.game_id,
        playerId: r.player_id,
        playerName: r.player_name ?? null,
        sportsbook: r.sportsbook ?? null,
        propType: r.prop_type ?? null,
        marketType: r.market_type ?? null,
        side: r.side ?? null,
        lineValue: r.line_value != null ? Number(r.line_value) : null,
        oddsAmerican: r.odds_american ?? null,
        oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
        impliedProbability: offerP != null && Number.isFinite(offerP) ? offerP : null,
        snapshotAt: r.snapshot_at instanceof Date ? r.snapshot_at.toISOString() : r.snapshot_at,
        ...evFields,
        evSelectedTrack: selectedTrack,
        calibrationVersion: cal,
      };
    });

    let outRows = rows;
    if (minEv != null && Number.isFinite(minEv)) {
      outRows = outRows.filter((r) => r.ev != null && Number.isFinite(r.ev) && r.ev >= minEv);
    }

    if (COMPUTED_SORTS.has(sort)) {
      outRows = [...outRows].sort((a, b) => {
        const ka = sortKey(a, sort);
        const kb = sortKey(b, sort);
        const cmp = ka - kb;
        return dirAsc ? cmp : -cmp;
      });
      outRows = outRows.slice(offset, offset + limit);
    }

    return NextResponse.json({
      rows: outRows,
      limit,
      offset,
      meta: {
        totalMatching,
        evSelectedTrack: selectedTrack,
        calibrationVersion: getCalibrationVersion(),
        computedAt: new Date().toISOString(),
        evFetchCap: COMPUTED_SORTS.has(sort) ? EV_FETCH_CAP : null,
        sort,
        dir: dirAsc ? 'asc' : 'desc',
      },
    });
  } catch (error: unknown) {
    console.error('props-explorer:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch props explorer',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
