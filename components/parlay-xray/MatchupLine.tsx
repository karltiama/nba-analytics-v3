import { TeamLogo } from '@/components/nba/TeamLogo';
import { matchupDisplayFromLeg } from '@/lib/parlay-xray/matchup-display';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';

export function MatchupLine({ leg }: { leg: ExtractedParlayLeg }) {
  const display = matchupDisplayFromLeg(leg);
  if (!display) {
    return (
      <p className="text-xs text-[#4a6366] truncate">{leg.matchupLabel.value ?? 'Matchup unavailable'}</p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-[#4a6366] min-w-0">
      <TeamLogo team={display.left} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.left}</span>
      <span>{display.separator}</span>
      <TeamLogo team={display.right} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.right}</span>
    </p>
  );
}
