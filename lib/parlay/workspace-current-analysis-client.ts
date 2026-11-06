/**
 * Browser-side loader for current-props Workspace analysis. Fetches the replay context + deps
 * built from the DB per game (`POST /api/parlay-workspace/context`), then runs the shared analysis
 * locally. Model projections are never part of this path.
 */
import type { HistoricalXrayReplayResult } from '@/lib/parlay-xray/e2e/types';
import type { WorkspaceCurrentReplay } from './workspace-current-context';
import type { SelectedParlayLeg } from './selection';
import { runWorkspaceCurrentGamesAnalysis } from './workspace-analysis';

export const WORKSPACE_CURRENT_CONTEXT_PATH = '/api/parlay-workspace/context';

/** One entry per game, in slip order, with that game's deduped players. */
export function workspaceCurrentContextRequest(legs: SelectedParlayLeg[]): {
  games: { gameId: string; playerIds: string[] }[];
} {
  const byGame = new Map<string, Set<string>>();
  for (const leg of legs) {
    const players = byGame.get(leg.offer.gameId) ?? new Set<string>();
    players.add(leg.offer.playerId);
    byGame.set(leg.offer.gameId, players);
  }
  return { games: [...byGame].map(([gameId, players]) => ({ gameId, playerIds: [...players] })) };
}

export async function runWorkspaceCurrentAnalysis(
  legs: SelectedParlayLeg[],
  fetcher: typeof fetch = fetch
): Promise<HistoricalXrayReplayResult> {
  const response = await fetcher(WORKSPACE_CURRENT_CONTEXT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(workspaceCurrentContextRequest(legs)),
  });
  if (!response.ok) throw new Error(`WORKSPACE_CURRENT_CONTEXT_${response.status}`);
  const body = (await response.json()) as { replays: WorkspaceCurrentReplay[] };
  return runWorkspaceCurrentGamesAnalysis(legs, body.replays, { currentAnalysisEnabled: true });
}
