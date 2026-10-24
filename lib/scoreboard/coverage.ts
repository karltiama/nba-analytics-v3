/**
 * Whether a scoreboard date was checked recently enough to describe an empty slate.
 * Pure: the collector clock and the season calendar only. No flags, no provider calls.
 * A fresh clock means we finished a games request. It does not mean the league has no games.
 */

import { POSTSEASON_START_ET, REGULAR_SEASON_OPEN_ET } from '@/lib/games/season-eligibility';
import { etYmd, shiftEtYmd } from '@/lib/games/status-sync-query';
import type { ScoreboardSeasonType } from './contract';
import { SCOREBOARD_POLICY } from './planner';
import { SCOREBOARD_DISCOVERY_STALE_SLACK_MS } from './response';

export type ScoreboardCoverageState = 'covered' | 'not_collected' | 'unknown';

export type ScoreboardCoverage = {
  state: ScoreboardCoverageState;
  last_games_request_at: string | null;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Season start year: August–December belong to that year; January–July belong to the previous year. */
function seasonStartYear(date: string): string | null {
  const match = YMD.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return String(month >= 8 ? year : year - 1);
}

/**
 * Season types a finished games request must have checked for this ET date.
 * Null when the calendar cannot say which types apply (no regular-season open,
 * or the postseason floor is missing on/after April 1).
 */
export function expectedSeasonTypes(date: string): ScoreboardSeasonType[] | null {
  const season = seasonStartYear(date);
  if (!season) return null;
  const regularOpen = REGULAR_SEASON_OPEN_ET[season];
  if (!regularOpen) return null;
  if (date < regularOpen) return ['preseason'];
  const postseasonStart = POSTSEASON_START_ET[season];
  if (postseasonStart && date >= postseasonStart) return ['playin', 'playoffs'];
  if (!postseasonStart && date >= `${Number(season) + 1}-04-01`) return null;
  return ['regular'];
}

function acceptableClock(date: string, now: Date, raw: string | null | undefined): { ms: number; raw: string } | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const bound = SCOREBOARD_POLICY.DISCOVERY_INTERVAL_MS + SCOREBOARD_DISCOVERY_STALE_SLACK_MS;
  if (now.getTime() - ms > bound) return null;
  const clockDay = etYmd(new Date(ms));
  if (clockDay <= date && date <= shiftEtYmd(clockDay, 1)) return { ms, raw };
  return null;
}

export function scoreboardDateCoverage(input: {
  date: string;
  now: Date;
  lastRequestBySeasonType: Partial<Record<ScoreboardSeasonType, string | null>>;
}): ScoreboardCoverage {
  const types = expectedSeasonTypes(input.date);
  // No calendar to judge against: do not call the date "not collected".
  if (!types) return { state: 'unknown', last_games_request_at: null };

  const clocks: Array<{ ms: number; raw: string }> = [];
  for (const seasonType of types) {
    const clock = acceptableClock(input.date, input.now, input.lastRequestBySeasonType[seasonType]);
    if (!clock) {
      clocks.length = 0;
      break;
    }
    clocks.push(clock);
  }
  if (clocks.length === types.length) {
    const oldest = clocks.reduce((best, clock) => (clock.ms < best.ms ? clock : best));
    return { state: 'covered', last_games_request_at: oldest.raw };
  }
  if (input.date >= etYmd(input.now)) return { state: 'not_collected', last_games_request_at: null };
  return { state: 'unknown', last_games_request_at: null };
}
