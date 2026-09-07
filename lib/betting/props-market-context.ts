/**
 * Props Explorer serving context: live current markets vs historical closing/decision lines.
 * Date comparison is ET calendar dates (YYYY-MM-DD). A date strictly before today ET
 * is historical research — not a live sportsbook offer.
 */

export type PropsMarketContext = 'live' | 'historical';

export type PropsServingSource =
  | 'analytics.player_props_current'
  | 'research.prop_decision_lines';

export function etCalendarDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function etCalendarDateFromInstant(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return etCalendarDate(d);
}

export function resolvePropsMarketContext(input: {
  dateEt: string;
  todayEt: string;
}): PropsMarketContext {
  const dateEt = input.dateEt.trim();
  const todayEt = input.todayEt.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateEt) && /^\d{4}-\d{2}-\d{2}$/.test(todayEt) && dateEt < todayEt) {
    return 'historical';
  }
  return 'live';
}

export function propsServingSource(context: PropsMarketContext): PropsServingSource {
  return context === 'historical'
    ? 'research.prop_decision_lines'
    : 'analytics.player_props_current';
}

export function propsLineLabel(context: PropsMarketContext): string {
  return context === 'historical' ? 'Historical closing line' : 'Current market';
}

export function historicalPaperBetAllowed(): false {
  return false;
}

export function isActivePaperBetAllowed(input: {
  gameStartTime: string | Date | null | undefined;
  now?: Date;
}): boolean {
  if (input.gameStartTime == null) return false;
  const start =
    input.gameStartTime instanceof Date
      ? input.gameStartTime
      : new Date(input.gameStartTime);
  if (Number.isNaN(start.getTime())) return false;
  const now = input.now ?? new Date();
  return start.getTime() > now.getTime();
}

/** Block open paper bets on completed historical games. Replay mode is out of scope. */
export function shouldBlockActivePaperBet(input: {
  gameStartTime: string | Date | null | undefined;
  gameStatus?: string | null;
  todayEt: string;
}): boolean {
  const status = (input.gameStatus ?? '').trim().toLowerCase();
  if (status === 'final') return true;
  const dateEt = etCalendarDateFromInstant(input.gameStartTime);
  if (dateEt != null && dateEt < input.todayEt) return true;
  return false;
}
