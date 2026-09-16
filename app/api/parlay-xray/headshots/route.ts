import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { lookupHeadshotIds, XRAY_HEADSHOT_MAX_NAMES } from '@/lib/parlay-xray/headshots-lookup';
import { LOAD_PLAYERS_SQL } from '@/lib/parlay-xray/resolution/load-catalog';
import type { XrayPlayerRecord } from '@/lib/parlay-xray/resolution/types';

export const runtime = 'nodejs';

function namesFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !('names' in body) || !Array.isArray((body as { names: unknown }).names)) {
    return [];
  }
  return (body as { names: unknown[] }).names
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, XRAY_HEADSHOT_MAX_NAMES);
}

/**
 * POST /api/parlay-xray/headshots
 * Resolve display names to NBA CDN ids for extracted-leg portraits.
 * Read-only. Does not call OpenAI or rewrite OCR names.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) {
    return NextResponse.json({ result: 'AUTH_REQUIRED', players: [] }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return gate.withAuthCookies(NextResponse.json({ result: 'OK', players: [] }));
  }

  const names = namesFromBody(body);
  if (names.length === 0) {
    return gate.withAuthCookies(NextResponse.json({ result: 'OK', players: [] }));
  }

  try {
    const rows = await query<{
      player_id: string;
      entity_id: string | null;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      nba_player_id: string | null;
    }>(LOAD_PLAYERS_SQL);
    const players: XrayPlayerRecord[] = rows.map((row) => ({
      playerId: row.player_id,
      entityId: row.entity_id,
      displayName: row.full_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      nbaPlayerId: row.nba_player_id,
    }));
    const lookedUp = lookupHeadshotIds(names, players);
    return gate.withAuthCookies(NextResponse.json({ result: 'OK', players: lookedUp }));
  } catch {
    return gate.withAuthCookies(NextResponse.json({ result: 'OK', players: [] }));
  }
}
