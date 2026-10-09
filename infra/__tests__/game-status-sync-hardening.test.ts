import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFixtureFetchPage,
  createMemoryGameStore,
  runGameStatusSync,
  type GameStatusSyncEvent,
} from '@/lib/games/status-sync';

const read = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');

function block(src: string, type: string, name: string): string {
  const start = src.indexOf(`resource "${type}" "${name}"`);
  expect(start, `${type}.${name}`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nresource "', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

const LIVE_GATE =
  'count               = var.game_status_sync_create && var.game_status_sync_enable_schedule && local.family_schedule_enabled.game_status_sync ? 1 : 0';

describe('game-status-sync pre-activation hardening', () => {
  const alerts = read('alerts.tf');
  const sync = read('game-status-sync.tf');

  it('readiness filters match ready=false only; unverified also requires coverage=db_only', () => {
    const notReady = block(alerts, 'aws_cloudwatch_log_metric_filter', 'game_status_sync_readiness_not_ready');
    expect(notReady).toContain('count          = var.game_status_sync_create ? 1 : 0');
    expect(notReady).toContain('pattern        = "{ $.event = \\"season_phase_readiness\\" && $.ready IS FALSE }"');
    expect(notReady).toContain('name      = "ReadinessNotReady-game_status_sync"');

    const unverified = block(alerts, 'aws_cloudwatch_log_metric_filter', 'game_status_sync_readiness_unverified');
    expect(unverified).toContain(
      'pattern        = "{ $.event = \\"season_phase_readiness\\" && $.ready IS FALSE && $.coverage = \\"db_only\\" }"'
    );
    expect(unverified).toContain('name      = "ReadinessUnverified-game_status_sync"');
  });

  it('readiness alarm exists only while status-sync is live, alerts on 2 of 3 windows, and routes to SNS', () => {
    const alarm = block(alerts, 'aws_cloudwatch_metric_alarm', 'game_status_sync_readiness_not_ready');
    expect(alarm).toContain(LIVE_GATE);
    expect(alarm).toContain('metric_name         = "ReadinessNotReady-game_status_sync"');
    expect(alarm).toMatch(/period\s*=\s*900/);
    expect(alarm).toMatch(/evaluation_periods\s*=\s*3/);
    expect(alarm).toMatch(/datapoints_to_alarm\s*=\s*2/);
    expect(alarm).toMatch(/treat_missing_data\s*=\s*"notBreaching"/);
    expect(alarm).toMatch(/alarm_actions\s*=\s*local\.ingestion_alarm_actions/);
  });

  it('async invoke config: zero automatic retries, events older than one cadence dropped', () => {
    const cfg = block(sync, 'aws_lambda_function_event_invoke_config', 'game_status_sync');
    expect(cfg).toContain('count                        = var.game_status_sync_create ? 1 : 0');
    expect(cfg).toContain('function_name                = aws_lambda_function.game_status_sync[0].function_name');
    expect(cfg).toContain('maximum_retry_attempts       = 0');
    expect(cfg).toContain('maximum_event_age_in_seconds = 900');
    expect(cfg).not.toMatch(/destination_config|qualifier/);
  });

  it('filter field names match the event status-sync actually logs', async () => {
    const events: GameStatusSyncEvent[] = [];
    const run = async (games: Parameters<typeof createFixtureFetchPage>[0]) => {
      events.length = 0;
      await runGameStatusSync({
        env: {
          DATA_MODE: 'live_api',
          OFFSEASON_MODE: '0',
          CRON_DRY_RUN: '0',
          LIVE_INGESTION_ENABLED: 'true',
          STATUS_SYNC_TARGET_SEASON: '2026',
        },
        now: new Date('2026-11-03T16:00:00.000Z'),
        dryRun: false,
        store: createMemoryGameStore([], { seasonPhase: true }),
        fetchPage: createFixtureFetchPage(games),
        emit: (e) => events.push(e),
      });
      return JSON.parse(JSON.stringify({ job: 'game_status_sync', ...events.find((e) => e.event === 'season_phase_readiness') }));
    };

    const empty = await run([]);
    expect(empty).toMatchObject({ event: 'season_phase_readiness', ready: true, coverage: 'provider_verified' });

    const gap = await run([
      { id: 5, season: 2026, date: '2026-11-04', datetime: '2026-11-05T00:00:00.000Z', home_team: null, visitor_team: { id: 2 } },
    ]);
    expect(gap).toMatchObject({ event: 'season_phase_readiness', ready: false, coverage: 'provider_verified' });
    expect(typeof gap.ready).toBe('boolean');
  });
});
