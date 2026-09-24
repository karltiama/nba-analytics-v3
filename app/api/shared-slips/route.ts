/**
 * POST /api/shared-slips — authenticated create of an immutable shared slip snapshot.
 * Public reads use GET /api/shared-slips/[shareId] (no auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveSupabaseAuth } from '@/lib/auth/supabase-user';
import { CANONICAL_BET_SLIP_SOURCES, type CanonicalBetSlipSource } from '@/lib/bet-slip';
import {
  createSharedBetSlip,
  parseCanonicalBetLeg,
  type CanonicalBetLeg,
} from '@/lib/bet-slip/server';

const createBodySchema = z.object({
  source: z.enum(CANONICAL_BET_SLIP_SOURCES),
  title: z.string().max(200).nullable().optional(),
  legs: z.array(z.unknown()).min(1),
});

export async function POST(request: NextRequest) {
  const ar = await resolveSupabaseAuth(request);
  if (!ar.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { auth, withAuthCookies } = ar;

  try {
    const body = await request.json();
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return withAuthCookies(
        NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
      );
    }

    const legs: CanonicalBetLeg[] = [];
    for (const raw of parsed.data.legs) {
      const leg = parseCanonicalBetLeg(raw);
      if (!leg) {
        return withAuthCookies(
          NextResponse.json({ error: 'Invalid leg in snapshot' }, { status: 400 })
        );
      }
      legs.push(leg);
    }

    const result = await createSharedBetSlip({
      createdBy: auth.userId,
      slip: {
        legs,
        source: parsed.data.source as CanonicalBetSlipSource,
        title: parsed.data.title ?? null,
      },
    });

    if (!result.ok) {
      const status =
        result.code === 'EMPTY_SLIP' ||
        result.code === 'INVALID_LEG' ||
        result.code === 'INVALID_SOURCE' ||
        result.code === 'LEG_CAP'
          ? 400
          : 500;
      return withAuthCookies(NextResponse.json({ error: result.code, message: result.message }, { status }));
    }

    return withAuthCookies(NextResponse.json({ share: result.share }));
  } catch (error: unknown) {
    return withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to create shared slip',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
