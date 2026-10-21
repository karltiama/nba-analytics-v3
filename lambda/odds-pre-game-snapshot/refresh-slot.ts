export const DISCOVERY_REFRESH_MS = 24 * 60 * 60 * 1000;
export const SIX_HOUR_REFRESH_MS = 3 * 60 * 60 * 1000;
export const TWO_HOUR_REFRESH_MS = 60 * 60 * 1000;
export const T60_REFRESH_MS = 30 * 60 * 1000;
export const T15_REFRESH_MS = 20 * 60 * 1000;

const SLOT_MS: Record<string, number> = {
  six_hour: SIX_HOUR_REFRESH_MS,
  two_hour: TWO_HOUR_REFRESH_MS,
  t60: T60_REFRESH_MS,
  t15: T15_REFRESH_MS,
};

export function oddsRefreshSlot(windowId: string, nowMs: number): number | null {
  const period = SLOT_MS[windowId];
  if (period == null) return null;
  return Math.floor(nowMs / period);
}

export function oddsClaimSortKey(input: {
  day: string;
  date: string;
  windowId: string;
  nowMs: number;
}): string {
  const base = `${input.day}#${input.date}#${input.windowId}`;
  const slot = oddsRefreshSlot(input.windowId, input.nowMs);
  return slot == null ? base : `${base}#${slot}`;
}
