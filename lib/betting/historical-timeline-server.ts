/**
 * Server-only certified game-flow flags from analytics.game_flow.
 * Never import from client bundles.
 */
import { query } from '@/lib/db';

export async function loadCertifiedGameFlowFlags(gameId: string): Promise<{
  timeline: boolean;
  rotationContext: boolean;
}> {
  const rows = await query<{ timeline_available: boolean; rotation_available: boolean }>(
    `SELECT timeline_available, rotation_available
     FROM analytics.game_flow
     WHERE game_id = $1`,
    [gameId]
  );
  const row = rows[0];
  return {
    timeline: row?.timeline_available === true,
    rotationContext: row?.rotation_available === true,
  };
}
