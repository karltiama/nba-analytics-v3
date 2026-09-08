import { NextRequest, NextResponse } from 'next/server';
import { getStripeBillingConfig } from '@/lib/billing/config';
import { processStripeEvent, verifyStripeWebhook } from '@/lib/billing/process-event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook
 * Stripe signature is the only authorization. Do not session-auth this route.
 */
export async function POST(request: NextRequest) {
  const cfg = getStripeBillingConfig();
  if (!cfg.ok) {
    return NextResponse.json({ error: cfg.error }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    event = verifyStripeWebhook({
      payload,
      signature,
      webhookSecret: cfg.config.webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await processStripeEvent(event);
    return NextResponse.json({ ok: true, outcome });
  } catch (error: unknown) {
    console.error('[billing/webhook]', error instanceof Error ? error.message : 'failed');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
