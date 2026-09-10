/**
 * Dashboard slate date resolution.
 * Historical ET dates (strictly before today ET) must not use the active-season pin.
 * Current/future dates keep the pin so 2026 placeholder schedule does not leak onto the live slate.
 */

import { resolvePropsMarketContext } from '@/lib/betting/props-market-context';
import { getGamesForCalendarDate, getGamesForDate } from '@/lib/betting/queries';

export type SlateGamePicker = 'calendar' | 'season';

export function shouldUnpinSlateSeason(dateEt: string, todayEt: string): boolean {
  return resolvePropsMarketContext({ dateEt, todayEt }) === 'historical';
}

export async function loadDashboardGamesForEtDate(
  dateEt: string,
  todayEt: string
): Promise<{ games: Awaited<ReturnType<typeof getGamesForDate>>; picker: SlateGamePicker }> {
  if (shouldUnpinSlateSeason(dateEt, todayEt)) {
    return { games: await getGamesForCalendarDate(dateEt), picker: 'calendar' };
  }
  return { games: await getGamesForDate(dateEt), picker: 'season' };
}
