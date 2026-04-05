import { query } from '@/lib/db';

export type PlayerResolveCandidate = {
  playerId: string;
  fullName: string;
};

export type PlayerResolveResult =
  | { status: 'matched'; playerId: string; fullName: string }
  | { status: 'ambiguous'; candidates: PlayerResolveCandidate[] }
  | { status: 'unmatched'; reason: string };

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a display name to analytics.players.player_id.
 * Conservative: multiple plausible rows → ambiguous (caller may pass resolved_player_id).
 */
export async function resolvePlayerName(rawName: string): Promise<PlayerResolveResult> {
  const name = normalizeName(rawName);
  if (!name) {
    return { status: 'unmatched', reason: 'Empty player name.' };
  }

  const exact = await query<{ player_id: string; full_name: string | null }>(
    `SELECT player_id::text AS player_id, full_name
     FROM analytics.players
     WHERE LOWER(TRIM(full_name)) = LOWER($1)
     LIMIT 5`,
    [name]
  );
  if (exact.length === 1 && exact[0]) {
    return {
      status: 'matched',
      playerId: String(exact[0].player_id),
      fullName: exact[0].full_name ?? name,
    };
  }
  if (exact.length > 1) {
    return {
      status: 'ambiguous',
      candidates: exact.map((r) => ({
        playerId: String(r.player_id),
        fullName: r.full_name ?? name,
      })),
    };
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const last = parts.length ? (parts[parts.length - 1] ?? '') : '';
  const first = parts.length > 1 ? parts[0] ?? '' : '';

  if (last.length >= 2 && first.length >= 2) {
    const firstLast = await query<{ player_id: string; full_name: string | null }>(
      `SELECT player_id::text AS player_id, full_name
       FROM analytics.players
       WHERE LOWER(TRIM(first_name)) = LOWER($1)
         AND LOWER(TRIM(last_name)) = LOWER($2)
       LIMIT 8`,
      [first, last]
    );
    if (firstLast.length === 1 && firstLast[0]) {
      return {
        status: 'matched',
        playerId: String(firstLast[0].player_id),
        fullName: firstLast[0].full_name ?? name,
      };
    }
    if (firstLast.length > 1) {
      return {
        status: 'ambiguous',
        candidates: firstLast.map((r) => ({
          playerId: String(r.player_id),
          fullName: r.full_name ?? name,
        })),
      };
    }
  }

  const ilike = await query<{ player_id: string; full_name: string | null }>(
    `SELECT player_id::text AS player_id, full_name
     FROM analytics.players
     WHERE full_name ILIKE $1
     ORDER BY LENGTH(full_name) ASC
     LIMIT 8`,
    [`%${name}%`]
  );
  if (ilike.length === 1 && ilike[0]) {
    return {
      status: 'matched',
      playerId: String(ilike[0].player_id),
      fullName: ilike[0].full_name ?? name,
    };
  }
  if (ilike.length > 1) {
    return {
      status: 'ambiguous',
      candidates: ilike.map((r) => ({
        playerId: String(r.player_id),
        fullName: r.full_name ?? name,
      })),
    };
  }

  if (last.length >= 2) {
    const lastOnly = await query<{ player_id: string; full_name: string | null }>(
      `SELECT player_id::text AS player_id, full_name
       FROM analytics.players
       WHERE LOWER(TRIM(last_name)) = LOWER($1)
       LIMIT 8`,
      [last]
    );
    if (lastOnly.length === 1 && lastOnly[0]) {
      return {
        status: 'matched',
        playerId: String(lastOnly[0].player_id),
        fullName: lastOnly[0].full_name ?? name,
      };
    }
    if (lastOnly.length > 1) {
      return {
        status: 'ambiguous',
        candidates: lastOnly.map((r) => ({
          playerId: String(r.player_id),
          fullName: r.full_name ?? name,
        })),
      };
    }
  }

  return { status: 'unmatched', reason: 'No player found for this name. Try editing the name to match the app roster.' };
}

export async function assertPlayerExists(playerId: string): Promise<PlayerResolveCandidate | null> {
  const row = await query<{ player_id: string; full_name: string | null }>(
    `SELECT player_id::text AS player_id, full_name FROM analytics.players WHERE player_id = $1 LIMIT 1`,
    [playerId]
  );
  const r = row[0];
  if (!r) return null;
  return { playerId: String(r.player_id), fullName: r.full_name ?? playerId };
}
