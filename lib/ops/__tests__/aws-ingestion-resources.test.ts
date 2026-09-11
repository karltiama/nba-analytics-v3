import { describe, expect, it } from 'vitest';
import { ingestionAwsResources } from '@/lib/ops/aws-ingestion-resources';

describe('ops AWS ingestion resource catalog names', () => {
  it('lists odds EventBridge rules 0-8 to match Terraform/AWS production', () => {
    const { lambdas } = ingestionAwsResources();
    const odds = lambdas.find((row) => row.id === 'game_odds');
    expect(odds?.eventBridgeRules).toEqual(
      Array.from({ length: 9 }, (_, i) => `odds-pre-game-snapshot-schedule-${i}`)
    );
  });

  it('lists props Scheduler names nba-player-props-0..2 and not the unused rate name', () => {
    const { lambdas } = ingestionAwsResources();
    const controller = lambdas.find((row) => row.id === 'player_props_controller');
    expect(controller?.schedulerSchedules).toEqual([
      'nba-player-props-0',
      'nba-player-props-1',
      'nba-player-props-2',
    ]);
    expect(controller?.schedulerSchedules).not.toContain('nba-player-props-schedule');
  });

  it('status-sync scheduler name matches Terraform', () => {
    const { lambdas } = ingestionAwsResources();
    const sync = lambdas.find((row) => row.id === 'game_status_sync');
    expect(sync?.functionName).toBe('game-status-sync');
    expect(sync?.schedulerSchedules).toEqual(['nba-game-status-sync-schedule']);
  });
});
