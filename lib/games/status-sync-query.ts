/**
 * Frequent /v1/games query planner. Default is a short ET date window + season.
 * Full-season polling is explicit/manual only — never the frequent default.
 */

export const STATUS_SYNC_TARGET_SEASON_ENV = 'STATUS_SYNC_TARGET_SEASON';
export const STATUS_SYNC_DEFAULT_TARGET_SEASON = 2026;
export const STATUS_SYNC_FREQUENT_LOOKBACK_DAYS = 1;
export const STATUS_SYNC_FREQUENT_LOOKAHEAD_DAYS = 1;
export const STATUS_SYNC_FREQUENT_MAX_PAGES = 3;
export const STATUS_SYNC_PER_PAGE = 100;
export const BDL_GAMES_V1_PATH = '/v1/games';

export type StatusSyncQueryMode = 'frequent' | 'full_season';

export type StatusSyncQueryPlan = {
  mode: StatusSyncQueryMode;
  targetSeason: number;
  startDate: string | null;
  endDate: string | null;
  perPage: number;
  maxPages: number;
  path: typeof BDL_GAMES_V1_PATH;
  params: URLSearchParams;
};

export function resolveStatusSyncTargetSeason(
  env: Record<string, string | undefined> = process.env,
  explicit?: number
): number {
  if (explicit != null && Number.isFinite(explicit)) return Math.trunc(explicit);
  const raw = (env[STATUS_SYNC_TARGET_SEASON_ENV] ?? '').trim();
  if (/^\d{4}$/.test(raw)) return Number(raw);
  return STATUS_SYNC_DEFAULT_TARGET_SEASON;
}

export type RequiredStatusSyncTargetSeason =
  | { ok: true; season: number }
  | { ok: false; reason: string };

/** Lambda/live mutation: missing, invalid, or protected historical seasons fail closed. */
export function parseRequiredStatusSyncTargetSeason(
  env: Record<string, string | undefined> = process.env,
  protectedSeasons: ReadonlySet<string>
): RequiredStatusSyncTargetSeason {
  const raw = (env[STATUS_SYNC_TARGET_SEASON_ENV] ?? '').trim();
  if (!raw) {
    return { ok: false, reason: `missing ${STATUS_SYNC_TARGET_SEASON_ENV}` };
  }
  if (!/^\d{4}$/.test(raw)) {
    return { ok: false, reason: `invalid ${STATUS_SYNC_TARGET_SEASON_ENV}` };
  }
  if (protectedSeasons.has(raw)) {
    return { ok: false, reason: `protected historical season ${raw}` };
  }
  return { ok: true, season: Number(raw) };
}

export function etYmd(now: Date, timeZone = 'America/New_York'): string {
  return now.toLocaleDateString('en-CA', { timeZone });
}

/** Shift an ET calendar date by whole days using a noon-ET anchor (DST-safe). */
export function shiftEtYmd(ymd: string, days: number, timeZone = 'America/New_York'): string {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`invalid ET ymd: ${ymd}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const noonEt = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T17:00:00.000Z`);
  noonEt.setUTCDate(noonEt.getUTCDate() + days);
  return noonEt.toLocaleDateString('en-CA', { timeZone });
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function planStatusSyncQuery(input: {
  mode?: StatusSyncQueryMode;
  targetSeason: number;
  now: Date;
  lookbackDays?: number;
  lookaheadDays?: number;
  startDate?: string;
  endDate?: string;
}): StatusSyncQueryPlan {
  const mode = input.mode ?? 'frequent';
  const params = new URLSearchParams();
  params.set('seasons[]', String(input.targetSeason));
  params.set('per_page', String(STATUS_SYNC_PER_PAGE));

  if (mode === 'full_season') {
    return {
      mode,
      targetSeason: input.targetSeason,
      startDate: null,
      endDate: null,
      perPage: STATUS_SYNC_PER_PAGE,
      maxPages: Number.POSITIVE_INFINITY,
      path: BDL_GAMES_V1_PATH,
      params,
    };
  }

  const explicitStart = input.startDate && YMD.test(input.startDate) ? input.startDate : null;
  const explicitEnd = input.endDate && YMD.test(input.endDate) ? input.endDate : null;
  const todayEt = etYmd(input.now);
  const startDate =
    explicitStart ?? shiftEtYmd(todayEt, -(input.lookbackDays ?? STATUS_SYNC_FREQUENT_LOOKBACK_DAYS));
  const endDate =
    explicitEnd ?? shiftEtYmd(todayEt, input.lookaheadDays ?? STATUS_SYNC_FREQUENT_LOOKAHEAD_DAYS);
  params.set('start_date', startDate);
  params.set('end_date', endDate);
  return {
    mode: 'frequent',
    targetSeason: input.targetSeason,
    startDate,
    endDate,
    perPage: STATUS_SYNC_PER_PAGE,
    maxPages: STATUS_SYNC_FREQUENT_MAX_PAGES,
    path: BDL_GAMES_V1_PATH,
    params,
  };
}

export function statusSyncRequestUrl(plan: StatusSyncQueryPlan, cursor?: number | null): string {
  const params = new URLSearchParams(plan.params);
  if (cursor != null) params.set('cursor', String(cursor));
  return `https://api.balldontlie.io${plan.path}?${params.toString()}`;
}

export function frequentQueryIsFullSeason(plan: StatusSyncQueryPlan): boolean {
  return plan.mode === 'frequent' && (plan.startDate == null || plan.endDate == null);
}
