import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { createFoundingProCheckout } from '@/lib/billing/checkout';

export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      await request.json().catch(() => ({}));
    }
  } catch {
    // Discard body. Client price/plan/customer/user/subscription IDs are never trusted.
  }

  const result = await createFoundingProCheckout({
    userId: gate.auth.userId,
    email: gate.auth.email,
  });
  if (!result.ok) {
    return gate.withAuthCookies(
      NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    );
  }
  return gate.withAuthCookies(NextResponse.json({ url: result.url }));
}
