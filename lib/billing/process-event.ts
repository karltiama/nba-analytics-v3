import type Stripe from 'stripe';
import { STRIPE_PROVIDER } from './config';
import { getStripeClient } from './stripe-client';
import { retrieveAndSyncSubscription, syncStripeSubscriptionToEntitlement, unixEventDate } from './sync-subscription';
import { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } from './webhook-store';

export const HANDLED_STRIPE_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

function subscriptionIdFromUnknown(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const anyInv = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  return (
    subscriptionIdFromUnknown(anyInv.subscription) ??
    subscriptionIdFromUnknown(anyInv.parent?.subscription_details?.subscription)
  );
}

async function syncBySubscriptionId(subscriptionId: string | null, eventAt: Date): Promise<void> {
  if (!subscriptionId) return;
  const out = await retrieveAndSyncSubscription(subscriptionId, eventAt);
  if (!out.ok) {
    throw new Error(out.error);
  }
}

export async function processStripeEvent(event: Stripe.Event): Promise<'processed' | 'ignored' | 'duplicate'> {
  const claim = await claimWebhookEvent({
    provider: STRIPE_PROVIDER,
    eventId: event.id,
    eventType: event.type,
  });
  if (claim === 'duplicate') return 'duplicate';

  try {
    if (!HANDLED_STRIPE_EVENTS.has(event.type)) {
      await completeWebhookEvent({
        provider: STRIPE_PROVIDER,
        eventId: event.id,
        outcome: 'ignored',
      });
      return 'ignored';
    }

    const eventAt = unixEventDate(event.created);
    const stripe = getStripeClient();
    if (!stripe) throw new Error('Billing is not configured');

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;
        await syncBySubscriptionId(subId, eventAt);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const live = await stripe.subscriptions.retrieve(sub.id);
        const out = await syncStripeSubscriptionToEntitlement({ subscription: live, eventAt });
        if (!out.ok) throw new Error(out.error);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const out = await syncStripeSubscriptionToEntitlement({
          subscription: sub,
          eventAt,
          deleted: true,
        });
        if (!out.ok) throw new Error(out.error);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await syncBySubscriptionId(subscriptionIdFromInvoice(invoice), eventAt);
        break;
      }
      default:
        break;
    }

    await completeWebhookEvent({
      provider: STRIPE_PROVIDER,
      eventId: event.id,
      outcome: 'processed',
    });
    return 'processed';
  } catch (error: unknown) {
    await releaseWebhookEvent({ provider: STRIPE_PROVIDER, eventId: event.id });
    throw error;
  }
}

export function verifyStripeWebhook(input: {
  payload: string;
  signature: string | null;
  webhookSecret: string;
}): Stripe.Event {
  const stripe = getStripeClient();
  if (!stripe) throw new Error('Billing is not configured');
  if (!input.signature) throw new Error('Missing stripe-signature');
  return stripe.webhooks.constructEvent(input.payload, input.signature, input.webhookSecret);
}
