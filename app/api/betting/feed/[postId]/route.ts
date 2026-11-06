import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { FEED_NOTE_MAX } from '@/lib/feed/feed-rules';
import { hideFeedPostForOwner, reportFeedPost } from '@/lib/feed/feed-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('report'), reason: z.string().max(FEED_NOTE_MAX).nullable().optional() }),
]);

/**
 * POST /api/betting/feed/[postId]  { action: 'hide' } | { action: 'report', reason? }
 * Hide: owner only. The post keeps counting toward the record and the daily cap.
 * Report: any signed-in user except the owner, once per post.
 * There is no edit or delete.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ postId: string }> }) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  const { postId } = await context.params;
  if (!UUID_RE.test(postId ?? '')) {
    return gate.withAuthCookies(NextResponse.json({ error: 'Not found' }, { status: 404 }));
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return gate.withAuthCookies(NextResponse.json({ error: 'Invalid body' }, { status: 400 }));
  }

  try {
    if (parsed.data.action === 'hide') {
      const ok = await hideFeedPostForOwner(gate.auth.userId, postId);
      return gate.withAuthCookies(
        ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
      );
    }
    const out = await reportFeedPost({
      reporterId: gate.auth.userId,
      postId,
      reason: parsed.data.reason?.trim() || null,
    });
    return gate.withAuthCookies(
      out === 'reported' ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
    );
  } catch (error: unknown) {
    console.error('[feed post action]', error);
    return gate.withAuthCookies(
      NextResponse.json(
        { error: 'Action failed', message: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      )
    );
  }
}
