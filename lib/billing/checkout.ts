import { getUserEntitlements } from '@/lib/entitlements/queries';
import { getStripeBillingConfig } from './config';
import { getStripeClient } from './stripe-client';
import { getOrCreateStripeCustomer } from './customers';
import { subscriptionCurrentPeriodEnd } from './map-stripe';

export type CheckoutCreateResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; code?: string };

export async function createFoundingProCheckout(input: {
  userId: string;
  email?: string | null;
}): Promise<CheckoutCreateResult> {
  const cfg = getStripeBillingConfig();
  if (!cfg.ok) return { ok: false, status: 503, error: cfg.error, code: 'BILLING_UNCONFIGURED' };

  const entitlement = await getUserEntitlements(input.userId);
  if (entitlement.isPro) {
    return {
      ok: false,
      status: 409,
      error: 'Founding Pro is already active. Manage billing instead of starting another subscription.',
      code: 'ALREADY_PRO',
    };
  }

  const stripe = getStripeClient();
  if (!stripe) return { ok: false, status: 503, error: 'Billing is not configured', code: 'BILLING_UNCONFIGURED' };

  try {
    const customer = await getOrCreateStripeCustomer({ userId: input.userId, email: input.email });
    if (!customer.ok) return { ok: false, status: 503, error: customer.error, code: 'CUSTOMER_FAILED' };

    const existing = await stripe.subscriptions.list({
      customer: customer.customerId,
      status: 'all',
      limit: 20,
    });
    const blocking = existing.data.find((sub) => {
      const priceMatch = (sub.items?.data ?? []).some((item) => {
        const id = typeof item.price === 'string' ? item.price : item.price?.id;
        return id === cfg.config.foundingProPriceId;
      });
      if (!priceMatch) return false;
      if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') return true;
      if (sub.status === 'incomplete' || sub.status === 'unpaid' || sub.status === 'paused') return true;
      if (sub.status === 'canceled') {
        const end = subscriptionCurrentPeriodEnd(sub);
        return Boolean(end && end.getTime() > Date.now());
      }
      if (sub.cancel_at_period_end && (sub.status === 'active' || sub.status === 'trialing')) return true;
      return false;
    });
    if (blocking) {
      return {
        ok: false,
        status: 409,
        error: 'An existing Founding Pro subscription is already on this account.',
        code: 'ALREADY_PRO',
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.customerId,
      client_reference_id: input.userId,
      line_items: [{ price: cfg.config.foundingProPriceId, quantity: 1 }],
      success_url: `${cfg.config.appBaseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cfg.config.appBaseUrl}/billing/cancel`,
      metadata: { app_user_id: input.userId },
      subscription_data: {
        metadata: { app_user_id: input.userId },
      },
      // Sandbox accounts enable Managed Payments by default; subscriptions need a
      // product tax code under that mode. Keep Checkout as a normal test subscription.
      managed_payments: { enabled: false },
    });

    if (!session.url) {
      return { ok: false, status: 500, error: 'Checkout session missing URL', code: 'CHECKOUT_FAILED' };
    }

    return { ok: true, url: session.url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Checkout session failed';
    console.error('[billing/checkout]', message);
    return { ok: false, status: 502, error: message, code: 'CHECKOUT_FAILED' };
  }
}
