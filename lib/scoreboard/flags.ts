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
/** Second gate for regular season. SCOREBOARD_COLLECT_REGULAR=1 alone never collects. */
export const SCOREBOARD_AUTHORIZE_REGULAR_ENV = 'SCOREBOARD_AUTHORIZE_REGULAR';
/**
 * Optional single ET date for a regular-season canary. Empty means the normal today/tomorrow window.
 * A value that is not an exact calendar date fails the cycle before any request.
 */
export const SCOREBOARD_CANARY_ET_DATE_ENV = 'SCOREBOARD_CANARY_ET_DATE';
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
    if (seasonType === 'regular') {
      if ((env[SCOREBOARD_AUTHORIZE_REGULAR_ENV] ?? '').trim() !== '1') {
        refused.push({ seasonType, reason: 'regular live acquisition requires separate approval' });
        continue;
      }
    } else if (!ACTIVATABLE_SCOREBOARD_SEASON_TYPES.has(seasonType)) {
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

export const SCOREBOARD_COLLECT_ODDS_ENV = 'SCOREBOARD_COLLECT_ODDS';
/** Regular-season live box scores. Unset or any value other than 1 does not call /v1/box_scores/live. */
export const SCOREBOARD_COLLECT_BOX_ENV = 'SCOREBOARD_COLLECT_BOX';

/**
 * Odds collection rides on the games decision: it never enables a season type and never bypasses the
 * freeze. With the family flag on, odds are requested only for games of season types already collecting.
 */
export function resolveScoreboardOddsCollection(
  env: Env,
  collection: ScoreboardCollectionDecision
): { enabled: boolean; seasonTypes: ScoreboardSeasonType[]; reason: string | null } {
  const raw = env[SCOREBOARD_COLLECT_ODDS_ENV];
  if (raw === undefined || raw.trim() === '') return { enabled: false, seasonTypes: [], reason: 'odds collection disabled' };
  if (raw.trim() !== '1') return { enabled: false, seasonTypes: [], reason: `invalid ${SCOREBOARD_COLLECT_ODDS_ENV}` };
  if (collection.frozen || collection.seasonTypes.length === 0) {
    return { enabled: false, seasonTypes: [], reason: collection.reason ?? 'no season type enabled for collection' };
  }
  // Regular-season markets belong to the dedicated odds writer. This collector must not
  // acquire them when recurring regular collection is turned on.
  const seasonTypes = collection.seasonTypes.filter((seasonType) => seasonType !== 'regular');
  if (seasonTypes.length === 0) {
    return { enabled: false, seasonTypes: [], reason: 'scoreboard odds are not collected for regular season' };
  }
  return { enabled: true, seasonTypes, reason: null };
}

export const SCOREBOARD_MARKETS_SERVING_ENV = 'SCOREBOARD_MARKETS_SERVING_ENABLED';

/**
 * Optional `market` on served games. Off (unset or not '1') serves games exactly as before and does
 * not read the odds tables, so markets can be hidden without touching collected records.
 */
export function isScoreboardMarketServingEnabled(env: Env): boolean {
  return (env[SCOREBOARD_MARKETS_SERVING_ENV] ?? '').trim() === '1';
}

export function isScoreboardServingEnabled(env: Env): { enabled: boolean; reason: string | null } {
  const raw = env[SCOREBOARD_SERVING_ENV];
  if (raw === undefined || raw.trim() === '') return { enabled: false, reason: 'serving_disabled' };
  if (raw.trim() !== '1') return { enabled: false, reason: 'serving_flag_invalid' };
  return { enabled: true, reason: null };
}

/** One-shot opening-night canary. A scheduled `{}` event does not match, so it keeps the deployed env. */
export const OPENING_NIGHT_CANARY_EVENT = 'opening-night-2026-10-20';

/**
 * Scheduled ticks keep the deployed env, where Terraform forces regular authorization off.
 * One manual invoke may pass the exact canary event. The returned env is a copy; process.env is not changed.
 * Freeze flags are copied through, so a frozen Lambda still makes no request.
 */
export function scoreboardInvocationEnv(
  event: unknown,
  base: Env
): Env {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return base;
  const record = event as { canary?: unknown };
  if (Object.keys(record).length !== 1 || record.canary !== OPENING_NIGHT_CANARY_EVENT) return base;
  return {
    ...base,
    SCOREBOARD_COLLECT_PRESEASON: '0',
    SCOREBOARD_COLLECT_REGULAR: '1',
    [SCOREBOARD_AUTHORIZE_REGULAR_ENV]: '1',
    [SCOREBOARD_CANARY_ET_DATE_ENV]: '2026-10-20',
    SCOREBOARD_COLLECT_PLAYIN: '0',
    SCOREBOARD_COLLECT_PLAYOFFS: '0',
    SCOREBOARD_COLLECT_ODDS: '0',
    BDL_RATE_LIMIT_INTERVAL_MS: '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
  };
}

/** Empty is no pin. Anything other than YYYY-MM-DD fails closed. */
export function parseScoreboardCanaryEtDate(env: Env): { ok: true; date: string | null } | { ok: false; reason: string } {
  const raw = (env[SCOREBOARD_CANARY_ET_DATE_ENV] ?? '').trim();
  if (!raw) return { ok: true, date: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { ok: false, reason: `invalid ${SCOREBOARD_CANARY_ET_DATE_ENV}` };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return { ok: false, reason: `invalid ${SCOREBOARD_CANARY_ET_DATE_ENV}` };
  }
  return { ok: true, date: raw };
}

/** Missing or malformed target season fails closed; no default year. */
export function parseScoreboardTargetSeason(env: Env): { ok: true; season: number } | { ok: false; reason: string } {
  const raw = (env[SCOREBOARD_TARGET_SEASON_ENV] ?? '').trim();
  if (!raw) return { ok: false, reason: `missing ${SCOREBOARD_TARGET_SEASON_ENV}` };
  if (!/^\d{4}$/.test(raw)) return { ok: false, reason: `invalid ${SCOREBOARD_TARGET_SEASON_ENV}` };
  return { ok: true, season: Number(raw) };
}
