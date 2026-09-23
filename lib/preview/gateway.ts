import { previewGameDetails, previewPlayerPropsResponse, previewSidebarProps } from './game-fixture';
import { previewMarketResponse } from './market-fixture';
import { previewGameLogPayload } from './player-fixture';
import {
  deletePreviewSavedProp,
  listPreviewPaperBets,
  listPreviewSavedProps,
  savePreviewPaperBet,
  savePreviewProp,
} from './persistence';
import { previewExplorerResponse, previewGamesListResponse } from './props-fixture';
import type { PreviewScenario } from './scenario';
import { previewWowyContext, previewWowyPlayers, previewWowySummary } from './wowy-fixture';
import { xrayExtractHttp } from './xray-preview';

export type PreviewFetchInput = RequestInfo | URL;

export type PreviewDecision =
  | { action: 'passthrough' }
  | { action: 'json'; status: number; body: unknown };

const BLOCKED_MESSAGE = 'Preview mode does not perform this external action.';

function asUrl(input: PreviewFetchInput): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, 'http://preview.local');
    if (input instanceof URL) return input;
    return new URL(input.url, 'http://preview.local');
  } catch {
    return null;
  }
}

function methodOf(init: RequestInit | undefined, input: PreviewFetchInput): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

async function readJson(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  const body = init?.body;
  if (typeof body !== 'string') return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(status: number, body: unknown): PreviewDecision {
  return { action: 'json', status, body };
}

function decide(result: { status: number; body: unknown }): PreviewDecision {
  return json(result.status, result.body);
}

function blocked(status = 403): PreviewDecision {
  return json(status, {
    error: 'PREVIEW_BLOCKED',
    message: BLOCKED_MESSAGE,
    providerAttempted: false,
    preview: true,
  });
}

export async function resolvePreviewRequest(
  input: PreviewFetchInput,
  init: RequestInit | undefined,
  scenario: PreviewScenario | null
): Promise<PreviewDecision> {
  if (!scenario) return { action: 'passthrough' };
  const url = asUrl(input);
  if (!url) return { action: 'passthrough' };
  const path = url.pathname;
  if (!path.startsWith('/api/')) return { action: 'passthrough' };
  const method = methodOf(init, input);

  if (path === '/api/billing/checkout' || path === '/api/billing/portal' || path === '/api/billing/webhook') {
    return blocked();
  }
  if (path === '/api/billing/status' && method === 'GET') {
    return json(200, { plan: 'free', preview: true, providerAttempted: false });
  }
  if (path === '/api/parlay-xray/extract' && method === 'POST') {
    return decide(xrayExtractHttp(scenario));
  }
  if (path === '/api/parlay-xray/headshots' && method === 'POST') {
    return json(200, { players: [], providerAttempted: false });
  }
  if (path === '/api/parlay-xray/quota' && method === 'GET') {
    return json(200, { quota: { used: 0, limit: 5, remaining: 5 } });
  }
  if (path === '/api/betting/props-explorer' && method === 'GET') {
    return decide(previewExplorerResponse(scenario, url.searchParams));
  }
  if (path === '/api/betting/props-explorer/market' && method === 'GET') {
    return decide(previewMarketResponse(scenario, url.searchParams));
  }
  if (path === '/api/betting/games' && method === 'GET') {
    return decide(previewGamesListResponse(scenario));
  }

  const gameDetails = path.match(/^\/api\/betting\/games\/([^/]+)\/details$/);
  if (gameDetails && method === 'GET') return decide(previewGameDetails(scenario, decodeURIComponent(gameDetails[1])));
  const playerProps = path.match(/^\/api\/betting\/games\/([^/]+)\/player-props$/);
  if (playerProps && method === 'GET') return decide(previewPlayerPropsResponse(scenario));
  const matchup = path.match(/^\/api\/betting\/games\/([^/]+)\/matchup-analysis$/);
  if (matchup && method === 'GET') {
    if (scenario === 'error') return json(500, { error: 'Preview error scenario' });
    return json(200, { starting_lineups: { home: null, away: null } });
  }
  const timeline = path.match(/^\/api\/betting\/games\/([^/]+)\/timeline$/);
  if (timeline && method === 'GET') {
    if (scenario === 'error') return json(500, { error: 'Preview error scenario' });
    return json(200, { events: [] });
  }
  const aiSummary = path.match(/^\/api\/betting\/games\/([^/]+)\/ai-projection-summary$/);
  if (aiSummary && method === 'POST') {
    if (scenario === 'error') {
      return json(500, { error: 'Preview error scenario', providerAttempted: false });
    }
    return json(200, {
      summary: 'Preview summary only. No model was called.',
      eligible: true,
      providerAttempted: false,
    });
  }

  const gameLog = path.match(/^\/api\/betting\/players\/([^/]+)\/game-log-preview$/);
  if (gameLog && method === 'GET') {
    return decide(previewGameLogPayload(decodeURIComponent(gameLog[1]), scenario));
  }
  const playerPropsApi = path.match(/^\/api\/betting\/players\/([^/]+)\/props$/);
  if (playerPropsApi && method === 'GET') {
    return decide(previewSidebarProps(scenario, decodeURIComponent(playerPropsApi[1])));
  }
  if (
    (path === '/api/betting/players/trending' || path === '/api/betting/players/trending-strip') &&
    method === 'GET'
  ) {
    if (scenario === 'error') return json(500, { error: 'Preview error scenario' });
    return json(200, { players: [] });
  }

  if (path === '/api/wowy/players' && method === 'GET') {
    return decide(previewWowyPlayers(scenario, url.searchParams.get('q') ?? ''));
  }
  if (path === '/api/wowy/context' && method === 'GET') {
    return decide(previewWowyContext(
      scenario,
      url.searchParams.get('playerId') ?? '',
      url.searchParams.get('season') ?? '',
      url.searchParams.get('teamId') ?? ''
    ));
  }
  if ((path === '/api/wowy/pair' || path === '/api/wowy/model-pair') && method === 'GET') {
    const seasonType = url.searchParams.get('seasonType');
    return decide(previewWowySummary({
      scenario,
      subjectPlayerId: url.searchParams.get('subjectPlayerId') ?? '',
      teammatePlayerId: url.searchParams.get('teammatePlayerId'),
      season: url.searchParams.get('season') ?? '2025',
      teamId: url.searchParams.get('teamId') ?? '',
      seasonType: seasonType === 'playoffs' || seasonType === 'all' ? seasonType : 'regular',
    }));
  }

  if (path === '/api/user/saved-props' && method === 'GET') {
    return json(200, { rows: listPreviewSavedProps() });
  }
  if (path === '/api/user/saved-props' && method === 'POST') {
    const payload = await readJson(init);
    const row = savePreviewProp({
      gameId: String(payload.gameId ?? ''),
      playerId: Number(payload.playerId ?? 0),
      playerName: typeof payload.playerName === 'string' ? payload.playerName : null,
      sportsbook: typeof payload.sportsbook === 'string' ? payload.sportsbook : null,
      propType: typeof payload.propType === 'string' ? payload.propType : null,
      side: typeof payload.side === 'string' ? payload.side : null,
      lineValue: typeof payload.lineValue === 'number' ? payload.lineValue : null,
      snapshotAt: typeof payload.snapshotAt === 'string' ? payload.snapshotAt : null,
    });
    return json(200, { id: row.id, preview: true, providerAttempted: false });
  }
  if (path === '/api/user/saved-props' && method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    deletePreviewSavedProp(id);
    return json(200, { ok: true, preview: true, providerAttempted: false });
  }
  if (path === '/api/betting/paper-bets' && method === 'GET') {
    return json(200, { rows: listPreviewPaperBets(), preview: true });
  }
  if (path === '/api/betting/paper-bets' && method === 'POST') {
    const payload = await readJson(init);
    const row = savePreviewPaperBet({
      gameId: String(payload.gameId ?? ''),
      playerId: Number(payload.playerId ?? 0),
      playerName: typeof payload.playerName === 'string' ? payload.playerName : null,
      propType: typeof payload.propType === 'string' ? payload.propType : null,
      side: typeof payload.side === 'string' ? payload.side : null,
      lineValue: typeof payload.lineValue === 'number' ? payload.lineValue : null,
      oddsAmerican: typeof payload.oddsAmerican === 'number' ? payload.oddsAmerican : null,
    });
    return json(200, { id: row.id, preview: true, providerAttempted: false });
  }

  if (method !== 'GET' && method !== 'HEAD') return blocked();
  return json(404, {
    error: 'Preview fixture is not available for this request.',
    preview: true,
    providerAttempted: false,
  });
}
