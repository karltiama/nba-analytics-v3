import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { handoffLiveXrayParlay, liveGamesWindow } from '@/lib/parlay-xray/live/handoff';
import { loadXrayResolutionCatalog, type ResolutionQuery } from '@/lib/parlay-xray/resolution/load-catalog';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';

export const runtime = 'nodejs';

const MAX_LEGS = 20;

// Latest season row per player. Read-only; no scores or box stats.
const ROSTER_TEAMS_SQL = `
  SELECT DISTINCT ON (r.player_id) r.player_id::text AS player_id, t.abbreviation
  FROM analytics.team_roster_current r
  JOIN analytics.teams t ON t.team_id = r.team_id
  ORDER BY r.player_id, r.season DESC
`;

function legsFromBody(body: unknown): ExtractedParlayLeg[] | null {
  if (!body || typeof body !== 'object' || !('legs' in body)) return null;
  const legs = (body as { legs: unknown }).legs;
  if (!Array.isArray(legs) || legs.length === 0 || legs.length > MAX_LEGS) return null;
  const ok = legs.every(
    (leg) =>
      leg &&
      typeof leg === 'object' &&
      'playerDisplayName' in leg &&
      'gameDate' in leg &&
      'teamAbbr' in leg &&
      'line' in leg
  );
  return ok ? (legs as ExtractedParlayLeg[]) : null;
}

/**
 * POST /api/parlay-xray/handoff
 * Resolve confirmed live XRay legs to Workspace offers against the product
 * catalog. Read-only. Never calls OpenAI. Identity comes from the catalog.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const legs = legsFromBody(body);
  if (!legs) {
    return gate.withAuthCookies(NextResponse.json({ ok: false, code: 'INVALID_REQUEST' }, { status: 400 }));
  }

  try {
    const now = new Date();
    const [catalog, rosterRows] = await Promise.all([
      loadXrayResolutionCatalog(query as ResolutionQuery, { gamesWindow: liveGamesWindow(now) }),
      query<{ player_id: string; abbreviation: string }>(ROSTER_TEAMS_SQL),
    ]);
    const rosterTeams = new Map(rosterRows.map((row) => [row.player_id, row.abbreviation]));
    const result = handoffLiveXrayParlay(legs, catalog, now, rosterTeams);
    return gate.withAuthCookies(NextResponse.json(result));
  } catch (error) {
    console.error('[parlay-xray] handoff error', error instanceof Error ? error.message : 'unknown');
    return gate.withAuthCookies(NextResponse.json({ ok: false, code: 'INTERNAL_ERROR' }, { status: 500 }));
  }
}
