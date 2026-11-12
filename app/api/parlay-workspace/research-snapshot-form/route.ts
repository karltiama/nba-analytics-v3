import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { loadResearchSnapshotForm } from '@/lib/parlay/research-snapshot-form-load';
import {
  HISTORICAL_PLAYER_FORM_BASIS,
  parseResearchSnapshotFormRequest,
} from '@/lib/parlay/research-snapshot-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/parlay-workspace/research-snapshot-form
 * Prior player form for a Research Snapshot ticket, cut off at each leg's observation time.
 * Does not read current prices, injuries, or projections, and does not write.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseResearchSnapshotFormRequest(body);
  if (!parsed.ok) {
    return gate.withAuthCookies(NextResponse.json({ error: parsed.error }, { status: 400 }));
  }

  try {
    const legs = await loadResearchSnapshotForm(parsed.legs, async <T,>(sql: string, params?: unknown[]) => {
      return (await query(sql, params)) as T[];
    });
    return gate.withAuthCookies(
      NextResponse.json({
        basis: HISTORICAL_PLAYER_FORM_BASIS,
        legs,
      })
    );
  } catch {
    return gate.withAuthCookies(
      NextResponse.json({ error: 'Historical player form could not be loaded.' }, { status: 500 })
    );
  }
}
