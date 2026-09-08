export const PLANS = ['free', 'founding_pro'] as const;
export type PlanId = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  'none',
  'active',
  'canceled',
  'past_due',
  'unpaid',
  'expired',
  'trialing',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Near-term gated capabilities. Do not add Stripe price IDs here. */
export const FEATURE_KEYS = [
  'line_shopping_detail',
  'market_movement',
  'ai_briefing',
  'advanced_history',
  'wowy',
  'alerts',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type EntitlementRow = {
  user_id: string;
  plan: string | null;
  status: string | null;
  current_period_end: string | Date | null;
  provider: string | null;
};

export type ResolvedEntitlement = {
  plan: PlanId;
  isPro: boolean;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  features: Record<FeatureKey, boolean>;
  source: 'default' | 'row' | 'dev_override';
};

export const FOUNDING_PRO_PRICE_CONCEPT = '$10/month';

export const UPGRADE_COPY: Record<FeatureKey, { title: string; detail: string }> = {
  line_shopping_detail: {
    title: 'Find the best book',
    detail: 'See the exact sportsbook offering the strongest line and price with Founding Pro.',
  },
  market_movement: {
    title: 'Movement history available with Founding Pro',
    detail: 'See open-to-close movement when snapshot history exists.',
  },
  ai_briefing: {
    title: 'AI research briefing — Founding Pro',
    detail: 'Founding Pro adds a synthesized slate and matchup briefing from the research context you already see.',
  },
  advanced_history: {
    title: 'Deeper historical research available with Founding Pro',
    detail: 'Unlock expanded historical exploration when that surface ships.',
  },
  wowy: {
    title: 'WOWY / role-shift analytics available with Founding Pro',
    detail: 'Unlock with/without-you splits when that surface ships.',
  },
  alerts: {
    title: 'Alerts available with Founding Pro',
    detail: 'Unlock line and research alerts when that surface ships.',
  },
};
