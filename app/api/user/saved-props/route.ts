import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { resolveSupabaseAuth } from '@/lib/auth/supabase-user';

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
});

function toStrId(v: number | string): string {
  return typeof v === 'number' ? String(v) : String(v).trim();
}

type SavedPropRow = {
  id: string;
  user_id: string;
  game_id: string;
  player_id: string | number;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  implied_probability: string | number | null;
  snapshot_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function mapSavedProp(row: SavedPropRow) {
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    playerId: Number(row.player_id),
    playerName: row.player_name,
    sportsbook: row.sportsbook,
    propType: row.prop_type,
    marketType: row.market_type,
    side: row.side,
    lineValue: row.line_value != null ? Number(row.line_value) : null,
    oddsAmerican: row.odds_american,
    impliedProbability: row.implied_probability != null ? Number(row.implied_probability) : null,
    snapshotAt: row.snapshot_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '100', 10) || 100));
    const rows = await query<SavedPropRow>(
      `SELECT id, user_id, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
              line_value, odds_american, implied_probability, snapshot_at, note, created_at, updated_at
       FROM public.user_saved_props
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT $2`,
      [auth.userId, limit]
    );
    return withAuthCookies(NextResponse.json({ rows: rows.map(mapSavedProp) }));
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

    const row = await queryOne<SavedPropRow>(
      `INSERT INTO public.user_saved_props (
         user_id, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
         line_value, odds_american, implied_probability, snapshot_at, note
       ) VALUES (
         $1::uuid, $2, $3::bigint, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13
       )
       ON CONFLICT (
         user_id,
         game_id,
         player_id,
         coalesce(sportsbook, ''),
         coalesce(prop_type, ''),
         coalesce(side, ''),
         coalesce(line_value, -999999.999),
         coalesce(snapshot_at, '1970-01-01 00:00:00+00'::timestamptz)
       )
       DO UPDATE SET note = COALESCE(EXCLUDED.note, public.user_saved_props.note)
       RETURNING id, user_id, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
                 line_value, odds_american, implied_probability, snapshot_at, note, created_at, updated_at`,
      [
        auth.userId,
        toStrId(d.gameId),
        toStrId(d.playerId),
        d.playerName ?? null,
        d.sportsbook ?? null,
        d.propType ?? null,
        d.marketType ?? null,
        d.side ?? null,
        d.lineValue ?? null,
        d.oddsAmerican ?? null,
        d.impliedProbability ?? null,
        d.snapshotAt ?? null,
        d.note ?? null,
      ]
    );

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

    const row = await queryOne<{ id: string }>(
      `DELETE FROM public.user_saved_props
       WHERE id = $1::uuid AND user_id = $2::uuid
       RETURNING id`,
      [id, auth.userId]
    );
    if (!row) {
      return withAuthCookies(NextResponse.json({ error: 'Saved prop not found' }, { status: 404 }));
    }
    return withAuthCookies(NextResponse.json({ ok: true, id: row.id }));
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
