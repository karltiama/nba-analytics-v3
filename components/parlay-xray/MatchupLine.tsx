import { TeamLogo } from '@/components/nba/TeamLogo';
import { matchupDisplayFromLeg } from '@/lib/parlay-xray/matchup-display';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';

export function MatchupLine({ leg }: { leg: ExtractedParlayLeg }) {
  const display = matchupDisplayFromLeg(leg);
  if (!display) {
    return (
      <p className="type-secondary truncate">{leg.matchupLabel.value ?? 'Matchup unavailable'}</p>
    );
  }
  return (
    <p className="type-secondary flex min-w-0 items-center gap-1">
      <TeamLogo team={display.left} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.left}</span>
      <span>{display.separator}</span>
      <TeamLogo team={display.right} size="xs" decorative />
      <span className="font-medium text-[#063f46]">{display.right}</span>
    </p>
  );
}
