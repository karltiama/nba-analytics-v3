/**
 * Kill switch for Parlay Workspace analysis of today's props (snapshotKind `live_current`).
 * Unset or any value other than '1' is off: live legs stay blocked with LIVE_CURRENT and the
 * context route returns 404. This flag does not change the `CURRENT_LIVE_ANALYSIS`
 * entitlement, which stays NOT_READY until Karl certifies it.
 */
export const PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENV = 'PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENABLED';

export function isWorkspaceCurrentAnalysisEnabled(env: Record<string, string | undefined>): boolean {
  return (env[PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENV] ?? '').trim() === '1';
}
