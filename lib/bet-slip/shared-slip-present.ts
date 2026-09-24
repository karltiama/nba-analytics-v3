import { marketDisplayLabel } from '@/lib/parlay/selection';
import type { CanonicalBetLeg, PublicSharedBetSlip } from '@/lib/bet-slip/types';

export function formatSharedOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatSharedLine(line: number): string {
  return Number.isInteger(line) ? String(line) : String(line);
}

export function sharedLegHeadline(leg: CanonicalBetLeg): string {
  const side = leg.side === 'over' ? 'Over' : 'Under';
  const market = marketDisplayLabel(leg.market);
  return `${side} ${formatSharedLine(leg.line)} ${market}`;
}

export function buildSharedSlipMetaDescription(share: PublicSharedBetSlip): string {
  const snippets = share.legs.slice(0, 3).map((leg) => {
    const name = leg.playerName?.trim() || `Player ${leg.playerId}`;
    const side = leg.side === 'over' ? 'O' : 'U';
    const market = marketDisplayLabel(leg.market)
      .split(' ')
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    return `${name} ${side}${formatSharedLine(leg.line)} ${market || leg.market}`;
  });
  const more = share.legs.length > 3 ? ' · …' : '';
  const body = snippets.join(' · ') + more;
  if (body.length <= 150) {
    return `${body}. Lines and odds from when this slip was shared on Court Context.`;
  }
  return `Court Context shared parlay — ${share.legs.length} legs. Lines and odds shown are from when this slip was shared.`;
}

export function buildSharedSlipMetaTitle(share: PublicSharedBetSlip): string {
  const custom = share.title?.trim();
  if (custom) return `${custom} | Court Context`;
  const n = share.legs.length;
  return `Court Context Parlay — ${n} Leg${n === 1 ? '' : 's'}`;
}
