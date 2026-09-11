import { describe, expect, it } from 'vitest';
import { classifyProviderCapabilityHealth, PROVIDER_CAPABILITY_CATALOG } from '@/lib/ops/provider-capability';
import { INGESTION_CADENCE } from '@/lib/ops/ingestion-cadence';

describe('provider capability catalog', () => {
  it('treats subscription block as BLOCKED, not FAILED', () => {
    const stats = PROVIDER_CAPABILITY_CATALOG.find((row) => row.id === 'v1_stats')!;
    expect(stats.state).toBe('BLOCKED_BY_SUBSCRIPTION');
    expect(classifyProviderCapabilityHealth(stats.state).health).toBe('BLOCKED');
    expect(classifyProviderCapabilityHealth(stats.state).health).not.toBe('FAILED');
  });

  it('does not claim GOAT Advanced/Plays are live', () => {
    expect(PROVIDER_CAPABILITY_CATALOG.find((row) => row.id === 'advanced')?.state).toBe('NOT_IMPLEMENTED');
    expect(PROVIDER_CAPABILITY_CATALOG.find((row) => row.id === 'plays')?.state).toBe('NOT_IMPLEMENTED');
  });
});

describe('ingestion cadence', () => {
  it('certifies nightly and props controller; leaves injuries/odds unset', () => {
    expect(INGESTION_CADENCE.schedule_nightly_bdl.intervalHours).toBe(24);
    expect(INGESTION_CADENCE.player_props_controller.intervalHours).toBe(0.5);
    expect(INGESTION_CADENCE.injuries.intervalHours).toBeNull();
    expect(INGESTION_CADENCE.game_odds.intervalHours).toBeNull();
    expect(INGESTION_CADENCE.game_status_sync.intervalHours).toBe(0.25);
    expect(INGESTION_CADENCE.game_status_sync.graceHours).toBe(0.25);
  });
});
