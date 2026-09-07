import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveSupabaseAuth } from '@/lib/auth/supabase-user';
import { etCalendarDate } from '@/lib/betting/props-market-context';
import {
  clampSavedResearchLimit,
  deleteSavedResearchForUser,
  insertSavedResearchForUser,
  listSavedResearchForUser,
  mapSavedResearchRow,
} from '@/lib/betting/saved-research-queries';

const savedPropSchema = z.object({
  gameId: z.union([z.number(), z.string()]),
  playerId: z.union([z.number(), z.string()]),
  playerName: z.string().nullable().optional(),
  sportsbook: z.string().nullable().optional(),
  propType: z.string().nullable().optional(),
  marketType: z.string().nullable().optional(),
  side: z.string().nullable().optional(),
  lineValue: z.number().nullable().optional(),
  oddsAmerican: z.number().int().nullable().optional(),
  impliedProbability: z.number().nullable().optional(),
  snapshotAt: z.string().datetime().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  marketContext: z.enum(['live', 'historical']).nullable().optional(),
  dateEt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function toStrId(v: number | string): string {
  return typeof v === 'number' ? String(v) : String(v).trim();
}

function mapSavedProp(row: Parameters<typeof mapSavedResearchRow>[0], todayEt = etCalendarDate()) {
  return mapSavedResearchRow(row, todayEt);
}

export async function GET(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const limit = clampSavedResearchLimit(request.nextUrl.searchParams.get('limit'));
    const rows = await listSavedResearchForUser({ userId: auth.userId, limit });
    return withAuthCookies(NextResponse.json({ rows }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to load saved props',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}

export async function POST(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const body = await request.json();
    const parsed = savedPropSchema.safeParse(body);
    if (!parsed.success) {
      return withAuthCookies(
        NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
      );
    }
    const d = parsed.data;

    const row = await insertSavedResearchForUser({
      userId: auth.userId,
      gameId: toStrId(d.gameId),
      playerId: toStrId(d.playerId),
      playerName: d.playerName ?? null,
      sportsbook: d.sportsbook ?? null,
      propType: d.propType ?? null,
      marketType: d.marketType ?? null,
      side: d.side ?? null,
      lineValue: d.lineValue ?? null,
      oddsAmerican: d.oddsAmerican ?? null,
      impliedProbability: d.impliedProbability ?? null,
      snapshotAt: d.snapshotAt ?? null,
      note: d.note ?? null,
      marketContext: d.marketContext ?? null,
      dateEt: d.dateEt ?? null,
    });

    if (!row) {
      return withAuthCookies(NextResponse.json({ error: 'Failed to save prop' }, { status: 500 }));
    }
    return withAuthCookies(NextResponse.json({ savedProp: mapSavedProp(row) }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to save prop',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}

export async function DELETE(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return withAuthCookies(NextResponse.json({ error: 'Missing id' }, { status: 400 }));

    const deleted = await deleteSavedResearchForUser({ userId: auth.userId, id });
    if (!deleted) {
      return withAuthCookies(NextResponse.json({ error: 'Saved prop not found' }, { status: 404 }));
    }
    return withAuthCookies(NextResponse.json({ ok: true, id: deleted }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to delete saved prop',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
