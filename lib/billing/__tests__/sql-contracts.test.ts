import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import {
  CLAIM_WEBHOOK_EVENT_SQL,
  COMPLETE_WEBHOOK_EVENT_SQL,
  RELEASE_WEBHOOK_EVENT_SQL,
} from '../webhook-store';
import { UPSERT_SUBSCRIPTION_SQL, UPSERT_CUSTOMER_SQL } from '../entitlement-store';

describe('billing SQL contracts', () => {
  it('claims webhook events with provider + event id uniqueness', () => {
    expect(CLAIM_WEBHOOK_EVENT_SQL).toMatch(/ON CONFLICT \(provider, provider_event_id\) DO NOTHING/i);
    expect(COMPLETE_WEBHOOK_EVENT_SQL).toMatch(/processed_at/i);
    expect(RELEASE_WEBHOOK_EVENT_SQL).toMatch(/processed_at IS NULL/i);
  });

  it('records last_provider_event_at as audit metadata without timestamp write suppression', () => {
    expect(UPSERT_SUBSCRIPTION_SQL).toMatch(/last_provider_event_at = GREATEST/i);
    expect(UPSERT_SUBSCRIPTION_SQL).not.toMatch(
      /WHERE public\.user_entitlements\.last_provider_event_at IS NULL/i
    );
    expect(UPSERT_SUBSCRIPTION_SQL).not.toMatch(
      /EXCLUDED\.last_provider_event_at >= public\.user_entitlements\.last_provider_event_at/i
    );
  });

  it('maps Stripe customer ids onto user_entitlements without granting Pro', () => {
    expect(UPSERT_CUSTOMER_SQL).toMatch(/'free'/);
    expect(UPSERT_CUSTOMER_SQL).toMatch(/'none'/);
  });
});
