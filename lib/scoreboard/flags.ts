/**
 * Scoreboard gates. Collection and serving are independent, and both fail closed:
 * only the exact value '1' enables; unset disables; any other value is invalid and disables.
 */

import { shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import {
  ACTIVATABLE_SCOREBOARD_SEASON_TYPES,
  SCOREBOARD_SEASON_TYPES,
  type ScoreboardSeasonType,
} from './contract';

type Env = Record<string, string | undefined>;

export const SCOREBOARD_COLLECT_ENV: Readonly<Record<ScoreboardSeasonType, string>> = {
  preseason: 'SCOREBOARD_COLLECT_PRESEASON',
  regular: 'SCOREBOARD_COLLECT_REGULAR',
  playin: 'SCOREBOARD_COLLECT_PLAYIN',
  playoffs: 'SCOREBOARD_COLLECT_PLAYOFFS',
};
export const SCOREBOARD_SERVING_ENV = 'SCOREBOARD_SERVING_ENABLED';
export const SCOREBOARD_TARGET_SEASON_ENV = 'SCOREBOARD_TARGET_SEASON';

export type ScoreboardCollectionDecision = {
  /** Season types this invocation may acquire. Empty means no BDL request of any kind. */
  seasonTypes: ScoreboardSeasonType[];
  refused: Array<{ seasonType: ScoreboardSeasonType; reason: string }>;
  frozen: boolean;
  reason: string | null;
};

function isLiveIngestionEnabled(env: Env): boolean {
  const raw = (env.LIVE_INGESTION_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export function resolveScoreboardCollection(env: Env): ScoreboardCollectionDecision {
  const refused: ScoreboardCollectionDecision['refused'] = [];
  const requested: ScoreboardSeasonType[] = [];
  for (const seasonType of SCOREBOARD_SEASON_TYPES) {
    const raw = env[SCOREBOARD_COLLECT_ENV[seasonType]];
    if (raw === undefined || raw.trim() === '') continue;
    if (raw.trim() !== '1') {
      refused.push({ seasonType, reason: `invalid ${SCOREBOARD_COLLECT_ENV[seasonType]}` });
      continue;
    }
    if (!ACTIVATABLE_SCOREBOARD_SEASON_TYPES.has(seasonType)) {
      refused.push({ seasonType, reason: `${seasonType} live acquisition requires separate approval` });
      continue;
    }
    requested.push(seasonType);
  }

  const frozenReason = !isLiveIngestionEnabled(env)
    ? 'LIVE_INGESTION_ENABLED is not set'
    : shouldSkipLiveMutations(env) || shouldSkipLiveBdlHttp(env)
      ? 'ingestion frozen (DATA_MODE / OFFSEASON_MODE / CRON_DRY_RUN)'
      : null;
  if (frozenReason) return { seasonTypes: [], refused, frozen: true, reason: frozenReason };
  if (requested.length === 0) {
    return { seasonTypes: [], refused, frozen: false, reason: 'no season type enabled for collection' };
  }
  return { seasonTypes: requested, refused, frozen: false, reason: null };
}

export function isScoreboardServingEnabled(env: Env): { enabled: boolean; reason: string | null } {
  const raw = env[SCOREBOARD_SERVING_ENV];
  if (raw === undefined || raw.trim() === '') return { enabled: false, reason: 'serving_disabled' };
  if (raw.trim() !== '1') return { enabled: false, reason: 'serving_flag_invalid' };
  return { enabled: true, reason: null };
}

/** Missing or malformed target season fails closed; no default year. */
export function parseScoreboardTargetSeason(env: Env): { ok: true; season: number } | { ok: false; reason: string } {
  const raw = (env[SCOREBOARD_TARGET_SEASON_ENV] ?? '').trim();
  if (!raw) return { ok: false, reason: `missing ${SCOREBOARD_TARGET_SEASON_ENV}` };
  if (!/^\d{4}$/.test(raw)) return { ok: false, reason: `invalid ${SCOREBOARD_TARGET_SEASON_ENV}` };
  return { ok: true, season: Number(raw) };
}
