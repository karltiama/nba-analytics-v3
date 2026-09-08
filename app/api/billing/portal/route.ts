import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { createBillingPortalSession } from '@/lib/billing/portal';

export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      await request.json().catch(() => ({}));
    }
  } catch {
    // ignore client-supplied customer ids
  }

  const result = await createBillingPortalSession(gate.auth.userId);
  if (!result.ok) {
    return gate.withAuthCookies(
      NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    );
  }
  return gate.withAuthCookies(NextResponse.json({ url: result.url }));
}
