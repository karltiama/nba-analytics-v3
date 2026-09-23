import {
  playerDisplayName,
  PREVIEW_GAMES,
  PREVIEW_SNAPSHOT_AT,
  PREVIEW_TEAMS,
  previewPlayerByKey,
  propsForScenario,
  type PreviewPropSeed,
} from './catalog';
import type { PreviewScenario } from './scenario';

export type PreviewExplorerRow = {
  id: string;
  gameId: number;
  playerId: number;
  playerName: string;
  sportsbook: string;
  propType: string;
  marketType: 'over_under';
  side: 'over' | 'under';
  lineValue: number;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  snapshotAt: string;
  modelProbability: number | null;
  ev: number | null;
  projection: number | null;
  evSelectedTrack: 'preview';
  calibrationVersion: null;
  confidenceTier: 'high' | 'medium' | 'low' | null;
  marketContext: 'live';
  lineLabel: string;
  paperBetAllowed: true;
  sourceTable: 'ccpreview';
};

export function previewExplorerRow(
  seed: PreviewPropSeed,
  scenario: PreviewScenario
): PreviewExplorerRow {
  const player = previewPlayerByKey(seed.playerKey);
  const game = PREVIEW_GAMES.find((row) => row.key === seed.gameKey);
  if (!game) throw new Error(`Missing preview game ${seed.gameKey}`);
  return {
    id: seed.id,
    gameId: game.gameId,
    playerId: player.playerId,
    playerName: playerDisplayName(player, scenario),
    sportsbook: seed.sportsbook,
    propType: seed.propType,
    marketType: 'over_under',
    side: seed.side,
    lineValue: seed.lineValue,
    oddsAmerican: seed.oddsAmerican,
    impliedProbability: seed.impliedProbability,
    snapshotAt: PREVIEW_SNAPSHOT_AT,
    modelProbability: seed.ev == null ? null : 0.5 + seed.ev,
    ev: seed.ev,
    projection: seed.projection,
    evSelectedTrack: 'preview',
    calibrationVersion: null,
    confidenceTier: seed.confidenceTier,
    marketContext: 'live',
    lineLabel: String(seed.lineValue),
    paperBetAllowed: true,
    sourceTable: 'ccpreview',
  };
}

export function previewExplorerRows(scenario: PreviewScenario): PreviewExplorerRow[] {
  return propsForScenario(scenario).map((seed) => previewExplorerRow(seed, scenario));
}

export function filterPreviewExplorerRows(
  rows: readonly PreviewExplorerRow[],
  params: URLSearchParams
): PreviewExplorerRow[] {
  const gameId = params.get('game_id')?.trim() ?? '';
  const playerName = (params.get('player_name') ?? '').trim().toLowerCase();
  const propType = (params.get('prop_type') ?? '').trim().toLowerCase();
  const side = (params.get('side') ?? 'all').trim().toLowerCase();
  const sportsbook = (params.get('sportsbook') ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (gameId && String(row.gameId) !== gameId) return false;
    if (playerName && !row.playerName.toLowerCase().includes(playerName)) return false;
    if (propType && row.propType !== propType) return false;
    if (side && side !== 'all' && row.side !== side) return false;
    if (sportsbook && !row.sportsbook.toLowerCase().includes(sportsbook)) return false;
    return true;
  });
}

export function previewExplorerResponse(scenario: PreviewScenario, params: URLSearchParams): {
  status: number;
  body: unknown;
} {
  if (scenario === 'error') {
    return {
      status: 500,
      body: { error: 'Failed to fetch props explorer', message: 'Preview error scenario' },
    };
  }
  const limit = Number(params.get('limit') || '100');
  const offset = Number(params.get('offset') || '0');
  const filtered = filterPreviewExplorerRows(previewExplorerRows(scenario), params);
  const page = filtered.slice(offset, offset + (Number.isFinite(limit) ? limit : 100));
  return {
    status: 200,
    body: {
      rows: page,
      limit,
      offset,
      meta: {
        totalMatching: filtered.length,
        evSelectedTrack: 'preview',
        calibrationVersion: null,
        computedAt: PREVIEW_SNAPSHOT_AT,
        evFetchCap: null,
        sort: params.get('sort') || 'snapshot_at',
        dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
        ingestionFrozen: true,
        marketContext: 'live',
        sourceTable: 'ccpreview',
        lineLabel: 'Preview',
        dateEt: params.get('date') || '2026-04-02',
      },
    },
  };
}

export function previewGamesListResponse(scenario: PreviewScenario): { status: number; body: unknown } {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Preview error scenario' } };
  }
  if (scenario === 'empty') {
    return {
      status: 200,
      body: { games: [], meta: { count: 0, ingestionFrozen: true, dataSource: 'ccpreview' } },
    };
  }
  const games = PREVIEW_GAMES.map((game) => {
    const away = PREVIEW_TEAMS[game.awayKey];
    const home = PREVIEW_TEAMS[game.homeKey];
    const name = scenario === 'mobile-dense' ? 'denseName' : 'name';
    return {
      id: String(game.gameId),
      awayTeam: { abbreviation: away.abbreviation, name: away[name] },
      homeTeam: { abbreviation: home.abbreviation, name: home[name] },
    };
  });
  return {
    status: 200,
    body: {
      games,
      meta: { count: games.length, ingestionFrozen: true, dataSource: 'ccpreview' },
    },
  };
}
