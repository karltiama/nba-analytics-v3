/**
 * Browser-side loader for current-props Workspace analysis. Fetches the replay context + deps
 * built from the DB (`POST /api/parlay-workspace/context`), then runs the shared analysis
 * locally. Model projections are never part of this path.
 */
import type { HistoricalXrayReplayResult } from '@/lib/parlay-xray/e2e/types';
import type { WorkspaceCurrentReplay } from './workspace-current-context';
import type { SelectedParlayLeg } from './selection';
import { runWorkspaceHistoricalAnalysis } from './workspace-analysis';

export const WORKSPACE_CURRENT_CONTEXT_PATH = '/api/parlay-workspace/context';

export function workspaceCurrentContextRequest(legs: SelectedParlayLeg[]): { gameId: string; playerIds: string[] } {
  const gameId = legs[0]?.offer.gameId ?? '';
  const playerIds = [...new Set(legs.map((leg) => leg.offer.playerId))];
  return { gameId, playerIds };
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
  const replay = (await response.json()) as WorkspaceCurrentReplay;
  return runWorkspaceHistoricalAnalysis(legs, replay.context, replay.deps, { currentAnalysisEnabled: true });
}
