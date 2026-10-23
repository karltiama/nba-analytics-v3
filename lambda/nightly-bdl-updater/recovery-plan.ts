/**
 * Default-off contract for one manually invoked analytics recovery.
 *
 * This does not thaw production. The handler still returns before any provider
 * call while DATA_MODE is not live_api, OFFSEASON_MODE=1, or CRON_DRY_RUN=1.
 * A future canary has to change those three flags under a separate approval,
 * keep nightly-bdl-updater-daily disabled, set INGESTION_SEASON_START_YEAR=2026,
 * and invoke with an explicit recovery payload. An empty scheduled event stays
 * on the nightly path and cannot select this mode.
 */

import { requireLiveIngestionSeasonStartYear } from './ingestion-season';
import { servingDateDecision } from './season-eligibility';

export const RECOVERY_SEASON_START_YEAR = 2026;
export const RECOVERY_MAX_GAMES = 14;
export const RECOVERY_MAX_WINDOW_DAYS = 2;
/** One NBA day fits in a 100-row games page. The second page is only for an unexpected cursor. */
export const RECOVERY_MAX_GAMES_PAGES = 2;
/** 14 games of player lines at 100 rows per page, plus one page that must not be required. */
export const RECOVERY_MAX_STATS_PAGES = 6;
export const RECOVERY_STATS_BATCH_SIZE = 25;
export const RECOVERY_PAGE_SIZE = 100;
/** Recovery never retries more times than this Lambda's own default. */
export const RECOVERY_MAX_RETRY_LIMIT = 3;
/**
 * Canary abort: 1 games page + 2 stats pages, 4 logical tries (1 + 3 server retries),
 * and 4 HTTP sends per try (1 + 3 limiter 429s). This does not raise the limiter.
 */
export const RECOVERY_CANARY_HTTP_ATTEMPT_CEILING = 48;
/** Exact value that blocks the ordinary nightly path during a recovery canary. */
export const RECOVERY_ONLY_ENV = 'RECOVERY_ONLY';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class RecoveryPlanError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = 'RecoveryPlanError';
  }
}

export type ExpectedFinal = {
  gameId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
};

export type RecoveryPlan = {
  seasonStartYear: typeof RECOVERY_SEASON_START_YEAR;
  startDate: string;
  endDate: string;
  gameIds: number[];
  duplicateIdsIgnored: number[];
  strictHttpBudget: boolean;
  expected: ExpectedFinal[];
};

export function isExplicitRecoveryEvent(event: unknown): boolean {
  return event != null && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, 'recovery');
}

export function recoveryOnlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RECOVERY_ONLY_ENV] === '1';
}

export function recoveryRetryLimit(maxRetries: number): number {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) return 0;
  return Math.min(maxRetries, RECOVERY_MAX_RETRY_LIMIT);
}

export function recoveryAttemptBudget(maxRetries: number): number {
  const retries = recoveryRetryLimit(maxRetries);
  return (RECOVERY_MAX_GAMES_PAGES + RECOVERY_MAX_STATS_PAGES) * (retries + 1);
}

export function inclusiveEtDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${endDate}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function isRealYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function requireYmd(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isRealYmd(value)) {
    throw new RecoveryPlanError(`${field} must be a real YYYY-MM-DD Eastern date`, 'invalid_date');
  }
  return value;
}

function parseGameId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function requireCount(value: unknown, field: string, allowZero: boolean): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RecoveryPlanError(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} integer`, 'invalid_expected_final');
  }
  return value;
}

function parseExpectedFinals(value: unknown, gameIds: readonly number[], required: boolean): ExpectedFinal[] {
  if (value == null) {
    if (required) {
      throw new RecoveryPlanError('RECOVERY_ONLY requires an expected final for every allowlisted game', 'canary_expected_required');
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RecoveryPlanError('recovery.expected must be an array', 'invalid_expected_final');
  }
  if (required && value.length === 0) {
    throw new RecoveryPlanError('RECOVERY_ONLY requires an expected final for every allowlisted game', 'canary_expected_required');
  }
  const allowed = new Set(gameIds);
  const seen = new Set<number>();
  const expected: ExpectedFinal[] = [];
  for (const item of value) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new RecoveryPlanError('recovery.expected contains a value that is not an object', 'invalid_expected_final');
    }
    const row = item as Record<string, unknown>;
    const gameId = parseGameId(row.gameId);
    if (gameId == null || !allowed.has(gameId)) {
      throw new RecoveryPlanError('recovery.expected names a game that is not on the allowlist', 'invalid_expected_final');
    }
    if (seen.has(gameId)) {
      throw new RecoveryPlanError(`recovery.expected repeats game ${gameId}`, 'invalid_expected_final');
    }
    seen.add(gameId);
    const homeTeamId = requireCount(row.homeTeamId, 'homeTeamId', false);
    const awayTeamId = requireCount(row.awayTeamId, 'awayTeamId', false);
    if (homeTeamId === awayTeamId) {
      throw new RecoveryPlanError(`recovery.expected game ${gameId} uses one team id twice`, 'invalid_expected_final');
    }
    expected.push({
      gameId,
      homeTeamId,
      awayTeamId,
      homeScore: requireCount(row.homeScore, 'homeScore', true),
      awayScore: requireCount(row.awayScore, 'awayScore', true),
    });
  }
  if (expected.length > 0) {
    for (const gameId of gameIds) {
      if (!seen.has(gameId)) {
        throw new RecoveryPlanError(`recovery.expected is missing game ${gameId}`, 'invalid_expected_final');
      }
    }
  }
  return expected;
}

function requireSeason2026(value: unknown, reason: string): void {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() === '2026' ? 2026 : Number.NaN;
  if (parsed !== RECOVERY_SEASON_START_YEAR) {
    throw new RecoveryPlanError('Recovery requires season start year 2026', reason);
  }
}

/**
 * Validate an explicit recovery payload. Call this only after the live-ingestion
 * freeze has already been cleared. It never reads the current date.
 */
export function planRecovery(event: unknown, env: NodeJS.ProcessEnv = process.env): RecoveryPlan {
  if (!isExplicitRecoveryEvent(event)) {
    throw new RecoveryPlanError('Recovery was not explicitly selected', 'recovery_not_selected');
  }
  const body = (event as { recovery?: unknown }).recovery;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RecoveryPlanError('recovery must be an object', 'invalid_recovery');
  }
  const record = body as Record<string, unknown>;

  const envSeason = requireLiveIngestionSeasonStartYear(env);
  if (envSeason !== RECOVERY_SEASON_START_YEAR) {
    throw new RecoveryPlanError(
      `INGESTION_SEASON_START_YEAR=${envSeason} is not the recovery season`,
      'season_not_recovery_target'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'seasonStartYear')) {
    throw new RecoveryPlanError('recovery.seasonStartYear is required', 'season_not_stated');
  }
  requireSeason2026(record.seasonStartYear, 'season_inconsistent');

  const startDate = requireYmd(record.startDate, 'startDate');
  const endDate = requireYmd(record.endDate, 'endDate');
  if (startDate > endDate) {
    throw new RecoveryPlanError('Recovery date window is reversed', 'reversed_window');
  }
  const days = inclusiveEtDays(startDate, endDate);
  if (days > RECOVERY_MAX_WINDOW_DAYS) {
    throw new RecoveryPlanError(
      `Recovery window is ${days} days; the maximum is ${RECOVERY_MAX_WINDOW_DAYS}`,
      'excessive_window'
    );
  }
  for (const date of [startDate, endDate]) {
    const decision = servingDateDecision(RECOVERY_SEASON_START_YEAR, date);
    if (!decision.eligible) {
      throw new RecoveryPlanError(`Recovery date ${date} is not in the 2026 regular season`, decision.reason);
    }
  }

  if (!Array.isArray(record.gameIds)) {
    throw new RecoveryPlanError('recovery.gameIds must be an array', 'invalid_allowlist');
  }
  if (record.gameIds.length === 0) {
    throw new RecoveryPlanError('Recovery requires at least one game id', 'empty_allowlist');
  }
  const gameIds: number[] = [];
  const duplicateIdsIgnored: number[] = [];
  const seen = new Set<number>();
  for (const value of record.gameIds) {
    const id = parseGameId(value);
    if (id == null) {
      throw new RecoveryPlanError('recovery.gameIds contains a value that is not a provider game id', 'invalid_game_id');
    }
    if (seen.has(id)) {
      duplicateIdsIgnored.push(id);
      continue;
    }
    seen.add(id);
    gameIds.push(id);
  }
  if (gameIds.length > RECOVERY_MAX_GAMES) {
    throw new RecoveryPlanError(
      `Recovery allowlist has ${gameIds.length} games; the maximum is ${RECOVERY_MAX_GAMES}`,
      'allowlist_too_large'
    );
  }

  const recoveryOnly = recoveryOnlyEnabled(env);
  if (record.strictHttpBudget != null && typeof record.strictHttpBudget !== 'boolean') {
    throw new RecoveryPlanError('recovery.strictHttpBudget must be boolean', 'invalid_http_budget');
  }
  if (recoveryOnly && record.strictHttpBudget === false) {
    throw new RecoveryPlanError('RECOVERY_ONLY cannot raise or disable the canary HTTP ceiling', 'http_budget_locked');
  }
  const strictHttpBudget = recoveryOnly || record.strictHttpBudget === true;

  return {
    seasonStartYear: RECOVERY_SEASON_START_YEAR,
    startDate,
    endDate,
    gameIds,
    duplicateIdsIgnored,
    strictHttpBudget,
    expected: parseExpectedFinals(record.expected, gameIds, recoveryOnly),
  };
}
