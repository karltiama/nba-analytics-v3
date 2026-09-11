/**
 * Certified vs unset ingestion cadence. Missed-run uses interval+grace only
 * when intervalHours is set. Do not invent uncertified production cadences.
 */

import type { IngestionFamilyId } from './ingestion-observability';

export type CadenceSpec = {
  intervalHours: number | null;
  graceHours: number;
  source: string;
};

export const INGESTION_CADENCE: Record<IngestionFamilyId, CadenceSpec> = {
  schedule_nightly_bdl: {
    intervalHours: 24,
    graceHours: 6,
    source: 'EventBridge cron(0 8 * * ? *) daily 08:00 UTC',
  },
  injuries: {
    intervalHours: null,
    graceHours: 6,
    source: '2–3x daily mentioned; exact cron CADENCE_UNSET',
  },
  game_odds: {
    intervalHours: null,
    graceHours: 6,
    source: 'multi-cron morning window; CADENCE_UNSET',
  },
  player_props_controller: {
    intervalHours: 0.5,
    graceHours: 0.5,
    source: 'EventBridge Scheduler default rate(30 minutes)',
  },
  player_props_worker: {
    intervalHours: null,
    graceHours: 1,
    source: 'SQS-driven; no schedule cadence',
  },
  bbref_boxscore: {
    intervalHours: 24,
    graceHours: 6,
    source: 'EventBridge daily 08:00 UTC',
  },
  advanced_postgame: { intervalHours: null, graceHours: 0, source: 'MANUAL_ONLY' },
  starters_lineups: { intervalHours: null, graceHours: 0, source: 'MANUAL_ONLY' },
  plays: { intervalHours: null, graceHours: 0, source: 'MANUAL_ONLY' },
  season_averages_role: { intervalHours: null, graceHours: 0, source: 'MANUAL_ONLY' },
  game_flow: { intervalHours: null, graceHours: 0, source: 'MANUAL_ONLY' },
  market_movement_capture: { intervalHours: null, graceHours: 0, source: 'NOT_DEPLOYED' },
  game_status_sync: {
    intervalHours: 0.25,
    graceHours: 0.25,
    source: 'EventBridge Scheduler rate(15 minutes); grace 15m',
  },
};

export function missedRunDeadlineMs(cadence: CadenceSpec): number | null {
  if (cadence.intervalHours == null) return null;
  return (cadence.intervalHours + cadence.graceHours) * 60 * 60 * 1000;
}
