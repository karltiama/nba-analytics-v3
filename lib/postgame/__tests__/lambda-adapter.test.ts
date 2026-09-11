import { describe, expect, it } from 'vitest';
import { handler } from '../../../lambda/postgame-stage-worker/index';

describe('CODE_ONLY postgame lambda adapter', () => {
  it('acks frozen records without batch failures', async () => {
    const prev = { ...process.env };
    process.env.DATA_MODE = 'replay';
    process.env.OFFSEASON_MODE = '1';
    process.env.CRON_DRY_RUN = '1';
    process.env.LIVE_INGESTION_ENABLED = '0';
    try {
      const r = await handler({
        Records: [{ messageId: 'm1', body: '{"v":1,"gameId":"1","season":"2026","stage":"box","attempt":1,"enqueuedAt":"x"}' }],
      });
      expect(r.skipped).toBe(true);
      expect(r.batchItemFailures).toEqual([]);
    } finally {
      process.env.DATA_MODE = prev.DATA_MODE;
      process.env.OFFSEASON_MODE = prev.OFFSEASON_MODE;
      process.env.CRON_DRY_RUN = prev.CRON_DRY_RUN;
      process.env.LIVE_INGESTION_ENABLED = prev.LIVE_INGESTION_ENABLED;
    }
  });

  it('does not silently succeed if thawed without a bundled worker', async () => {
    const prev = { ...process.env };
    process.env.DATA_MODE = 'live_api';
    process.env.OFFSEASON_MODE = '0';
    process.env.CRON_DRY_RUN = '0';
    process.env.LIVE_INGESTION_ENABLED = '1';
    try {
      const r = await handler({
        Records: [{ messageId: 'm2', body: '{}' }],
      });
      expect(r.skipped).toBe(false);
      expect(r.batchItemFailures).toEqual([{ itemIdentifier: 'm2' }]);
    } finally {
      process.env.DATA_MODE = prev.DATA_MODE;
      process.env.OFFSEASON_MODE = prev.OFFSEASON_MODE;
      process.env.CRON_DRY_RUN = prev.CRON_DRY_RUN;
      process.env.LIVE_INGESTION_ENABLED = prev.LIVE_INGESTION_ENABLED;
    }
  });
});
