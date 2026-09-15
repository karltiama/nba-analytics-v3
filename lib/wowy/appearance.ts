/**
 * Played / DNP semantics copied from lib/betting/minutes-projection-eval.ts
 * (classifyAppearance). Kept local so WOWY does not import the minutes-eval
 * module graph (player-prop model → lib/db).
 *
 * Source meaning, inspected on 2023–2025 Final logs:
 * - minutes "00" = DNP/inactive roster row; not an injury label
 * - minutes "0" = recorded 0-minute appearance (played)
 * - minutes > 0 = played, including 0-point games
 */

export type WowyAppearanceClass = 'played' | 'dnp' | 'malformed';

export interface WowyAppearanceInput {
  minutes: string | number | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  three_pointers_made?: number | null;
  field_goals_attempted?: number | null;
  free_throws_attempted?: number | null;
}

export interface WowyAppearanceClassification {
  class: WowyAppearanceClass;
  minutes: number | null;
  minutesToken: string | null;
  hasBoxActivity: boolean;
  reason: string;
}

export function parseMinutes(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function minutesToken(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  const token = String(value).trim();
  return token.length === 0 ? null : token;
}

function hasBoxActivity(log: WowyAppearanceInput): boolean {
  const box =
    (log.points ?? 0) +
    (log.rebounds ?? 0) +
    (log.assists ?? 0) +
    (log.three_pointers_made ?? 0) +
    (log.field_goals_attempted ?? 0) +
    (log.free_throws_attempted ?? 0);
  return box > 0;
}

export function classifyWowyAppearance(log: WowyAppearanceInput): WowyAppearanceClassification {
  const token = minutesToken(log.minutes);
  const minutes = parseMinutes(log.minutes);
  const box = hasBoxActivity(log);
  if (token == null || minutes == null) {
    return {
      class: 'malformed',
      minutes,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'null_or_non_numeric_minutes',
    };
  }
  if (minutes > 0) {
    return {
      class: 'played',
      minutes,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'minutes_gt_0',
    };
  }
  if (token === '00') {
    return {
      class: 'dnp',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: box ? 'minutes_00_dnp_with_anomalous_box' : 'minutes_00_dnp',
    };
  }
  if (token === '0' || token === '0.0') {
    return {
      class: 'played',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'zero_minute_appearance',
    };
  }
  if (box) {
    return {
      class: 'played',
      minutes: 0,
      minutesToken: token,
      hasBoxActivity: box,
      reason: 'zero_minutes_with_box_activity',
    };
  }
  return {
    class: 'dnp',
    minutes: 0,
    minutesToken: token,
    hasBoxActivity: box,
    reason: token === '00' ? 'minutes_00_dnp' : 'zero_minutes_no_box',
  };
}
