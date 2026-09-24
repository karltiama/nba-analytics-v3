import {
  getNbaTeamLogoSrc,
  getNbaTeamName,
  resolveNbaTeamAbbreviation,
  TEAM_LOGO_SCALE,
  type NbaTeamAbbreviation,
} from '@/lib/nba/team-logos';

export type TeamLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_BOX: Record<TeamLogoSize, string> = {
  xs: 'h-5 w-5',
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-14 w-14',
  xl: 'h-[4.5rem] w-[4.5rem]',
};

const FALLBACK_TYPE: Record<TeamLogoSize, string> = {
  xs: 'text-[11px]',
  sm: 'text-xs',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-sm',
};

const SIZE_IMG: Record<TeamLogoSize, string> = {
  xs: 'max-h-4 max-w-4',
  sm: 'max-h-8 max-w-8',
  md: 'max-h-10 max-w-10',
  lg: 'max-h-12 max-w-12',
  xl: 'max-h-16 max-w-16',
};

export interface TeamLogoProps {
  team: string;
  size?: TeamLogoSize;
  className?: string;
  alt?: string;
  decorative?: boolean;
}

function warnInvalidTeam(team: string) {
  if (process.env.NODE_ENV !== 'development') return;
  console.warn(`[TeamLogo] Unknown NBA team abbreviation: "${team}"`);
}

function FallbackMark({ label, size }: { label: string; size: TeamLogoSize }) {
  return (
    <span
      className={`flex ${SIZE_BOX[size]} items-center justify-center rounded-full bg-black/10 ${FALLBACK_TYPE[size]} font-bold uppercase tracking-wide text-current`}
    >
      {label.slice(0, 3)}
    </span>
  );
}

export function TeamLogo({
  team,
  size = 'md',
  className = '',
  alt,
  decorative = false,
}: TeamLogoProps) {
  const abbr = resolveNbaTeamAbbreviation(team);
  const src = abbr ? getNbaTeamLogoSrc(abbr) : null;

  if (!abbr || !src) {
    warnInvalidTeam(team);
    const fallbackLabel = team.trim().slice(0, 3) || '?';
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${SIZE_BOX[size]} ${className}`.trim()}>
        <FallbackMark label={fallbackLabel} size={size} />
      </span>
    );
  }

  const teamName = getNbaTeamName(abbr) ?? abbr;
  const scale = TEAM_LOGO_SCALE[abbr as NbaTeamAbbreviation] ?? 1;
  const resolvedAlt = decorative ? '' : (alt ?? `${teamName} logo`);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${SIZE_BOX[size]} ${className}`.trim()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={resolvedAlt}
        aria-hidden={decorative ? true : undefined}
        className={`${SIZE_IMG[size]} object-contain`}
        style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}
        draggable={false}
      />
    </span>
  );
}
