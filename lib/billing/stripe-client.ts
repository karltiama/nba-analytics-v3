import Stripe from 'stripe';
import { getStripeBillingConfig } from './config';

export function getStripeClient(): Stripe | null {
  const cfg = getStripeBillingConfig();
  if (!cfg.ok) return null;
  return new Stripe(cfg.config.secretKey);
}
