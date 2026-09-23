export type ExplorerValueGrade = 'good' | 'fair' | 'bad' | 'unknown';

/** Same thresholds the explorer table already uses. */
export function explorerValueGrade(ev: number | null | undefined): ExplorerValueGrade {
  if (ev == null || !Number.isFinite(ev)) return 'unknown';
  if (ev > 0.03) return 'good';
  if (ev < -0.02) return 'bad';
  return 'fair';
}

export function explorerValueToneClass(ev: number | null | undefined): string {
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (grade === 'bad') return 'bg-rose-50 text-rose-800 border-rose-200';
  if (grade === 'fair') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-[#F8FBFA] text-[#4a6366] border-[#DCE9EA]';
}

/** Desktop table copy. Classification is unchanged. */
export function explorerTableValueCopy(
  ev: number | null | undefined,
  marketContext?: 'live' | 'historical'
): string {
  if (marketContext === 'historical') return 'Unavailable';
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'Good Value';
  if (grade === 'bad') return 'Bad Value';
  if (grade === 'fair') return 'Fair Value';
  return 'No Signal';
}

/** One-line card label. Same grades, shorter words. */
export function explorerCardValueLabel(
  ev: number | null | undefined,
  marketContext?: 'live' | 'historical'
): string {
  if (marketContext === 'historical') return 'Unavailable';
  const grade = explorerValueGrade(ev);
  if (grade === 'good') return 'Good';
  if (grade === 'bad') return 'Bad';
  if (grade === 'fair') return 'Fair';
  return 'No signal';
}

export function formatExplorerOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

/** Full name. Missing names fall back to the id. No manual abbreviation. */
export function explorerCardPlayerName(
  playerName: string | null | undefined,
  playerId: number
): string {
  const raw = (playerName ?? '').trim();
  return raw || String(playerId);
}
