export const PLAYER_SEARCH_COMMIT_MS = 300;

export const EXPLORER_SORT_OPTIONS = [
  { value: 'snapshot_at', label: 'Snapshot time' },
  { value: 'ev', label: 'EV' },
  { value: 'confidence', label: 'Confidence tier' },
  { value: 'odds_american', label: 'American odds' },
] as const;

export const EXPLORER_BOOKS = [
  { id: 'draftkings', label: 'DraftKings' },
  { id: 'fanduel', label: 'FanDuel' },
  { id: 'betmgm', label: 'BetMGM' },
  { id: 'caesars', label: 'Caesars' },
  { id: 'betrivers', label: 'BetRivers' },
  { id: 'fanatics', label: 'Fanatics' },
] as const;

export const EXPLORER_PROP_TYPES = [
  { value: 'points', label: 'Points' },
  { value: 'rebounds', label: 'Rebounds' },
  { value: 'assists', label: 'Assists' },
  { value: 'threes', label: 'Threes' },
  { value: 'points_assists', label: 'Pts + Ast' },
  { value: 'points_rebounds', label: 'Pts + Reb' },
  { value: 'rebounds_assists', label: 'Reb + Ast' },
  { value: 'points_rebounds_assists', label: 'PRA' },
  { value: 'steals', label: 'Steals' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'turnovers', label: 'Turnovers' },
] as const;

/** Empty draft deletes the param. Other params are left to the existing updater. */
export function playerSearchUpdates(draft: string): { player_name: string | null; offset: '0' } {
  return { player_name: draft === '' ? null : draft, offset: '0' };
}

export type ExplorerFilterCountInput = {
  date: string;
  today: string;
  gameId: string;
  propType: string;
  side: string;
  minEv: string;
  sportsbook: string;
};

/**
 * Non-default sheet filters only.
 * Search stays on the page, so it is not counted.
 * Sort stays visible, so it is not counted.
 * Advanced metrics is a display toggle, not a result filter, so it is not counted.
 * Each selected sportsbook counts as one.
 */
export function explorerActiveFilterCount(input: ExplorerFilterCountInput): number {
  let count = 0;
  if (input.date !== input.today) count += 1;
  if (input.gameId.trim()) count += 1;
  if (input.propType.trim()) count += 1;
  if (input.side && input.side !== 'all') count += 1;
  if (input.minEv.trim()) count += 1;
  count += input.sportsbook.split(',').map((book) => book.trim()).filter(Boolean).length;
  return count;
}

/** Calendar date only. The Today action is a separate control. */
export function explorerCalendarDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Known explorer books keep their product names. Unknown names are title-cased. */
export function explorerBookDisplayName(name: string | null | undefined): string {
  if (!name || !name.trim()) return '—';
  const key = name.trim().toLowerCase().replace(/[\s_]+/g, '');
  const known = EXPLORER_BOOKS.find((book) => book.id.replace(/[\s_]+/g, '') === key);
  if (known) return known.label;
  return name
    .trim()
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function explorerPropContextLabel(
  propType: string | null | undefined,
  side: string | null | undefined,
  line: number | null | undefined
): string {
  const market = (propType ?? 'Prop').replace(/_/g, ' ');
  const sideLabel = side ? side.charAt(0).toUpperCase() + side.slice(1).toLowerCase() : '';
  const lineLabel = line != null && Number.isFinite(line) ? String(line) : '';
  const decision = [sideLabel, lineLabel].filter(Boolean).join(' ');
  return decision ? `${market} · ${decision}` : market;
}

export function toggleSportsbookParam(current: string, bookId: string): string | null {
  const next = new Set(current.split(',').map((book) => book.trim()).filter(Boolean));
  if (next.has(bookId)) next.delete(bookId);
  else next.add(bookId);
  const value = Array.from(next).join(',');
  return value || null;
}
