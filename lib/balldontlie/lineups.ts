/**
 * BallDontLie NBA lineups API (GOAT tier).
 * GET /nba/v1/lineups?game_ids[]=<id>
 * Lineup data is only available from 2025 season and once the game has begun.
 */

const BDL_BASE = 'https://api.balldontlie.io';
const LINEUPS_PATH = '/nba/v1/lineups';

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

  const bdlGameId = Number(gameId);
  if (Number.isNaN(bdlGameId)) return null;

  const url = new URL(LINEUPS_PATH, BDL_BASE);
  url.searchParams.set('game_ids[]', String(bdlGameId));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: key.trim() },
    });
  } catch {
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
