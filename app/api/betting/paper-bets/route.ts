import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { queryOne } from '@/lib/db';
import { etCalendarDate, shouldBlockActivePaperBet } from '@/lib/betting/props-market-context';
import {
  deleteOpenPaperBetForUser,
  insertPaperBetForUser,
  listPaperBetsForUser,
  normalizePaperBetStatus,
} from '@/lib/betting/paper-bets-queries';

const createBetSchema = z.object({
  gameId: z.union([z.number(), z.string()]),
  playerId: z.union([z.number(), z.string()]),
  playerName: z.string().nullable().optional(),
  sportsbook: z.string().nullable().optional(),
  propType: z.string().nullable().optional(),
  marketType: z.string().nullable().optional(),
  side: z.string().nullable().optional(),
  lineValue: z.number().nullable().optional(),
  oddsAmerican: z.number().nullable().optional(),
  impliedProbability: z.number().nullable().optional(),
  stakeUnits: z.number().positive().optional().default(1),
  ev: z.number().nullable().optional(),
  confidenceTier: z.enum(['high', 'medium', 'low']).nullable().optional(),
  calibrationVersion: z.string().nullable().optional(),
  decisionSnapshotAt: z.string().min(1),
  modelProbability: z.number().nullable().optional(),
  projection: z.number().nullable().optional(),
  evSelectedTrack: z.string().nullable().optional(),
});

function toStrId(v: number | string): string {
  return typeof v === 'number' ? String(v) : String(v).trim();
}

/**
 * GET /api/betting/paper-bets?status=open|settled|all&limit=&offset=
 * Auth required. Lists only the authenticated user's bets.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const sp = request.nextUrl.searchParams;
    const status = normalizePaperBetStatus(sp.get('status'));
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);

    const { bets, total } = await listPaperBetsForUser({
      userId: gate.auth.userId,
      status,
      limit,
      offset,
    });

    return gate.withAuthCookies(
      NextResponse.json({
        bets,
        meta: { total, limit, offset, status },
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const missing = message.includes('paper.bets') && message.includes('does not exist');
    console.error('[paper-bets GET]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          error: missing
            ? 'Paper bets table missing. Apply db/schemas/paper_schema.sql in Supabase.'
            : 'Failed to load paper bets',
          message,
          bets: [],
          meta: { total: 0, limit: 0, offset: 0, status: 'all' },
        },
        { status: missing ? 503 : 500 }
      )
    );
  }
}

/**
 * POST /api/betting/paper-bets
 * Auth required. Owner is always the session user (client user_id is ignored).
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const parsed = createBetSchema.safeParse(body);
    if (!parsed.success) {
      return gate.withAuthCookies(
        NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
      );
    }
    const d = parsed.data;
    const gameId = toStrId(d.gameId);
    const playerId = toStrId(d.playerId);

    const game = await queryOne<{ start_time: string | Date | null; status: string | null }>(
      `SELECT start_time, status FROM analytics.games WHERE game_id = $1`,
      [gameId]
    );
    if (!game) {
      return gate.withAuthCookies(
        NextResponse.json({ error: 'Game not found', code: 'GAME_NOT_FOUND' }, { status: 404 })
      );
    }
    if (
      shouldBlockActivePaperBet({
        gameStartTime: game.start_time,
        gameStatus: game.status,
        todayEt: etCalendarDate(),
      })
    ) {
      return gate.withAuthCookies(
        NextResponse.json(
          {
            error: 'Paper bets cannot be placed on completed historical games',
            code: 'HISTORICAL_GAME',
          },
          { status: 409 }
        )
      );
    }

    const bet = await insertPaperBetForUser({
      userId: gate.auth.userId,
      gameId,
      playerId,
      playerName: d.playerName ?? null,
      sportsbook: d.sportsbook ?? null,
      propType: d.propType ?? null,
      marketType: d.marketType ?? null,
      side: d.side ?? null,
      lineValue: d.lineValue ?? null,
      oddsAmerican: d.oddsAmerican ?? null,
      impliedProbability: d.impliedProbability ?? null,
      stakeUnits: d.stakeUnits,
      ev: d.ev ?? null,
      confidenceTier: d.confidenceTier ?? null,
      calibrationVersion: d.calibrationVersion ?? null,
      decisionSnapshotAt: d.decisionSnapshotAt,
      modelProbability: d.modelProbability ?? null,
      projection: d.projection ?? null,
      evSelectedTrack: d.evSelectedTrack ?? null,
    });

    if (!bet) {
      return gate.withAuthCookies(NextResponse.json({ error: 'Insert failed' }, { status: 500 }));
    }

    return gate.withAuthCookies(NextResponse.json({ bet }));
  } catch (error: unknown) {
    console.error('[paper-bets POST]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to create paper bet',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}

/**
 * DELETE /api/betting/paper-bets?id=<bet_id>
 * Removes an open paper bet owned by the authenticated user.
 */
export async function DELETE(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const id = (request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return gate.withAuthCookies(NextResponse.json({ error: 'Missing id' }, { status: 400 }));
    }

    const deleted = await deleteOpenPaperBetForUser({ userId: gate.auth.userId, id });
    if (!deleted) {
      return gate.withAuthCookies(NextResponse.json({ error: 'Open bet not found' }, { status: 404 }));
    }

    return gate.withAuthCookies(NextResponse.json({ ok: true, id: deleted }));
  } catch (error: unknown) {
    console.error('[paper-bets DELETE]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to remove paper bet',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
