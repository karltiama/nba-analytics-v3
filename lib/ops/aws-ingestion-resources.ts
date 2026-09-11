/**
 * Bounded Court Context AWS resource names. No account-wide scan.
 * Names match Terraform defaults. Env can override.
 */

export type AwsLambdaResource = {
  id: string;
  familyId: string | null;
  functionName: string;
  eventBridgeRules?: string[];
  schedulerSchedules?: string[];
  optional: boolean;
};

export type AwsQueueResource = {
  id: string;
  queueName: string;
  dlqName: string;
  optional: boolean;
};

export function ingestionAwsResources(
  env: Record<string, string | undefined> = process.env
): { lambdas: AwsLambdaResource[]; queues: AwsQueueResource[] } {
  const nightly = env.OPS_LAMBDA_NIGHTLY ?? 'nightly-bdl-updater';
  const odds = env.OPS_LAMBDA_ODDS ?? 'odds-pre-game-snapshot';
  const injuries = env.OPS_LAMBDA_INJURIES ?? 'injuries-snapshot';
  const propsWorker = env.OPS_LAMBDA_PROPS_WORKER ?? 'nba-player-props-ingestion-lambda';
  const propsController = env.OPS_LAMBDA_PROPS_CONTROLLER ?? 'nba-player-props-controller-lambda';
  const boxscore = env.OPS_LAMBDA_BOXSCORE ?? 'boxscore-scraper';
  const postgame = env.OPS_LAMBDA_POSTGAME ?? 'postgame-stage-worker';
  return {
    lambdas: [
      {
        id: 'schedule_nightly_bdl',
        familyId: 'schedule_nightly_bdl',
        functionName: nightly,
        eventBridgeRules: [`${nightly}-daily`],
        optional: false,
      },
      {
        id: 'game_odds',
        familyId: 'game_odds',
        functionName: odds,
        eventBridgeRules: Array.from(
          { length: Number(env.OPS_ODDS_RULE_COUNT ?? 9) },
          (_, i) => `${odds}-schedule-${i}`
        ),
        optional: false,
      },
      {
        id: 'injuries',
        familyId: 'injuries',
        functionName: injuries,
        eventBridgeRules: [`${injuries}-schedule`],
        optional: false,
      },
      {
        id: 'player_props_controller',
        familyId: 'player_props_controller',
        functionName: propsController,
        schedulerSchedules: env.OPS_PROPS_SCHEDULE
          ? [env.OPS_PROPS_SCHEDULE]
          : ['nba-player-props-0', 'nba-player-props-1', 'nba-player-props-2'],
        optional: false,
      },
      {
        id: 'player_props_worker',
        familyId: 'player_props_worker',
        functionName: propsWorker,
        optional: false,
      },
      {
        id: 'bbref_boxscore',
        familyId: 'bbref_boxscore',
        functionName: boxscore,
        eventBridgeRules: [`${boxscore}-daily`],
        optional: false,
      },
      {
        id: 'postgame_stage_worker',
        familyId: null,
        functionName: postgame,
        optional: true,
      },
      {
        id: 'game_status_sync',
        familyId: 'game_status_sync',
        functionName: env.OPS_LAMBDA_STATUS_SYNC ?? 'game-status-sync',
        schedulerSchedules: [env.OPS_STATUS_SYNC_SCHEDULE ?? 'nba-game-status-sync-schedule'],
        optional: true,
      },
    ],
    queues: [
      {
        id: 'player_props',
        queueName: env.OPS_PROPS_QUEUE ?? 'nba-player-props-game-queue',
        dlqName: env.OPS_PROPS_DLQ ?? 'nba-player-props-game-dlq',
        optional: false,
      },
      {
        id: 'postgame_stage',
        queueName: env.OPS_POSTGAME_QUEUE ?? 'nba-postgame-stage-queue',
        dlqName: env.OPS_POSTGAME_DLQ ?? 'nba-postgame-stage-dlq',
        optional: true,
      },
    ],
  };
}
