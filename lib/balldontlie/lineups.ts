/**
 * BallDontLie NBA lineups API (GOAT tier).
 * GET /nba/v1/lineups?game_ids[]=<id>
 * Lineup data is only available from 2025 season and once the game has begun.
 */

import { BdlRateLimitError, fetchBdlLive, shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';

export const BDL_LINEUPS_BASE = 'https://api.balldontlie.io';
export const LINEUPS_PATH = '/nba/v1/lineups';
const BDL_BASE = BDL_LINEUPS_BASE;

export interface BdlLineupTeam {
  id: number;
  abbreviation?: string | null;
  name?: string | null;
  full_name?: string | null;
  city?: string | null;
  conference?: string | null;
  division?: string | null;
}

export interface BdlLineupEntry {
  id: number;
  game_id: number;
  starter: boolean;
  position: string;
  player: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    team_id: number;
  };
  /**
   * Provider returns a top-level team object. This is the game-context team.
   * Do not substitute player.team_id — Step 8A found mismatches.
   */
  team: BdlLineupTeam;
}

export interface BdlLineupsResponse {
  data: BdlLineupEntry[];
  meta?: { next_cursor?: number | null; per_page?: number; current_page?: number };
}

/**
 * Fetch starting lineups for a game from BallDontLie.
 * Returns null on missing key, non-2xx, or empty/parse error.
 */
export async function fetchLineupsFromBallDontLie(
  gameId: string,
  apiKey: string | undefined
): Promise<BdlLineupsResponse | null> {
  const key = apiKey ?? process.env.BALLDONTLIE_API_KEY ?? process.env.BALDONTLIE_API_KEY;
  if (!key?.trim()) return null;
  if (shouldSkipLiveBdlHttp()) return null;

  const bdlGameId = Number(gameId);
  if (Number.isNaN(bdlGameId)) return null;

  const url = new URL(LINEUPS_PATH, BDL_BASE);
  url.searchParams.set('game_ids[]', String(bdlGameId));

  let res: Response;
  try {
    res = await fetchBdlLive(
      url.toString(),
      {
        method: 'GET',
        headers: { Authorization: key.trim() },
      },
      { worker: 'bdl-lineups' }
    );
  } catch (err) {
    if (err instanceof BdlRateLimitError) return null;
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const data = Array.isArray((body as any)?.data) ? (body as any).data : [];
  const meta = (body as any)?.meta;
  return { data, meta };
}
