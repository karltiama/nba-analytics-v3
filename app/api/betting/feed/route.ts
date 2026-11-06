import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { SHARED_SLIP_LEG_CAP, parseCanonicalBetLeg, type CanonicalBetLeg } from '@/lib/bet-slip/server';
import { etCalendarDate } from '@/lib/betting/props-market-context';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import {
  FEED_DAILY_POST_CAP,
  FEED_NOTE_MAX,
  checkFeedPostLock,
  validateFeedLegs,
  type FeedGameRow,
} from '@/lib/feed/feed-rules';
import {
  countFeedPostsForDay,
  getFeedRecordForUser,
  insertFeedPost,
  listFeedPostsForDay,
} from '@/lib/feed/feed-store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createBodySchema = z.object({
  legs: z.array(z.unknown()).min(1).max(SHARED_SLIP_LEG_CAP),
  note: z.string().max(FEED_NOTE_MAX).nullable().optional(),
});

function missingTable(message: string): boolean {
  return message.includes('does not exist') && message.includes('feed.');
}

function failure(message: string, fallback: string) {
  return NextResponse.json(
    {
      error: missingTable(message) ? 'Feed tables missing. Apply db/schemas/MIGRATION_feed_posts.sql.' : fallback,
      message,
    },
    { status: missingTable(message) ? 503 : 500 }
  );
}

/**
 * GET /api/betting/feed?date=YYYY-MM-DD&limit=
 * Auth required. Posts for that ET day plus the viewer's own record and daily allowance.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  const sp = request.nextUrl.searchParams;
  const today = etCalendarDate();
  const rawDate = sp.get('date')?.trim() ?? '';
  const dateEt = DATE_RE.test(rawDate) ? rawDate : today;
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50));

  try {
    const [posts, record, usedToday] = await Promise.all([
      listFeedPostsForDay({ dateEt, viewerId: gate.auth.userId, limit }),
      getFeedRecordForUser(gate.auth.userId),
      countFeedPostsForDay(gate.auth.userId, today),
    ]);
    return gate.withAuthCookies(
      NextResponse.json({
        date: dateEt,
        posts,
        viewer: {
          record,
          postsUsedToday: usedToday,
          postsLeftToday: Math.max(0, FEED_DAILY_POST_CAP - usedToday),
          dailyCap: FEED_DAILY_POST_CAP,
        },
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[feed GET]', error);
    return gate.withAuthCookies(failure(message, 'Failed to load feed'));
  }
}

/**
 * POST /api/betting/feed  { legs: CanonicalBetLeg[], note? }
 * Self-reported. Every leg's game must not have tipped off. Max 3 posts per user per ET day.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return gate.withAuthCookies(
        NextResponse.json({ error: 'INVALID_BODY', message: 'Add 1 or more legs to post.' }, { status: 400 })
      );
    }

    const legs: CanonicalBetLeg[] = [];
    for (const raw of parsed.data.legs) {
      const leg = parseCanonicalBetLeg(raw);
      if (!leg) {
        return gate.withAuthCookies(
          NextResponse.json({ error: 'INVALID_LEG', message: 'One of the legs could not be read.' }, { status: 400 })
        );
      }
      legs.push(leg);
    }

    const legError = validateFeedLegs(legs);
    if (legError) {
      return gate.withAuthCookies(NextResponse.json({ error: legError.code, message: legError.message }, { status: 400 }));
    }

    const today = etCalendarDate();
    if ((await countFeedPostsForDay(gate.auth.userId, today)) >= FEED_DAILY_POST_CAP) {
      return gate.withAuthCookies(
        NextResponse.json(
          { error: 'DAILY_CAP', message: `You've used all ${FEED_DAILY_POST_CAP} posts for today.` },
          { status: 429 }
        )
      );
    }

    const gameIds = [...new Set(legs.map((l) => l.gameId))];
    const games = await query<FeedGameRow>(
      `SELECT game_id, start_time, status FROM analytics.games WHERE game_id = ANY($1::text[])`,
      [gameIds]
    );
    const lock = checkFeedPostLock({ gameIds, games });
    if (!lock.ok) {
      const status = lock.code === 'GAME_NOT_FOUND' ? 404 : 409;
      const message =
        lock.code === 'GAME_NOT_FOUND'
          ? 'One of these games is not on the schedule.'
          : 'One of these games has already tipped off. Posts lock at tip-off.';
      return gate.withAuthCookies(NextResponse.json({ error: lock.code, message }, { status }));
    }

    const note = parsed.data.note?.trim() || null;
    const inserted = await insertFeedPost({
      userId: gate.auth.userId,
      postDateEt: today,
      note,
      legs,
      combinedOddsAmerican: combinedAmericanOdds(legs.map((l) => l.selectedOdds ?? null)),
      firstTipAt: lock.firstTipAt,
    });
    if (!inserted.ok) {
      return gate.withAuthCookies(
        NextResponse.json(
          { error: 'DAILY_CAP', message: `You've used all ${FEED_DAILY_POST_CAP} posts for today.` },
          { status: 429 }
        )
      );
    }

    return gate.withAuthCookies(
      NextResponse.json({
        post: { id: inserted.id, postedAt: inserted.postedAt },
        postsLeftToday: Math.max(0, FEED_DAILY_POST_CAP - inserted.dailySlot),
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[feed POST]', error);
    return gate.withAuthCookies(failure(message, 'Failed to post'));
  }
}
