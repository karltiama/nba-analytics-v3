import Link from 'next/link';
import {
  getNbaTeamLogoSrc,
  resolveNbaTeamAbbreviation,
} from '@/lib/nba/team-logos';

const HERO_COURT_MOTIF_SRC = '/landing/hero-court-right.png';

type PreviewHeroProps = {
  teamAbbr: string;
  teamName: string;
  conference: string | null;
  seasonLabel: string;
  dek: string;
  routeTeamId: string;
};

export function PreviewHero({
  teamAbbr,
  teamName,
  conference,
  seasonLabel,
  dek,
  routeTeamId,
}: PreviewHeroProps) {
  const conferenceLabel =
    conference === 'East' || conference === 'West'
      ? `${conference}ern Conference`
      : conference;

  const abbr = resolveNbaTeamAbbreviation(teamAbbr);
  const logoSrc = abbr ? getNbaTeamLogoSrc(abbr) : null;

  return (
    <header className="relative overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HERO_COURT_MOTIF_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-0 z-0 h-[140%] w-auto max-w-none -translate-y-1/2 opacity-[0.06] select-none"
      />

      {/* Oversized team mark — clipped by header, sits behind copy */}
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute -left-6 sm:-left-10 top-1/2 z-0 h-[220%] w-auto max-w-none -translate-y-1/2 opacity-[0.12] select-none object-contain"
        />
      ) : null}

      <div className="relative z-10 p-4 sm:p-6 lg:p-8">
        <nav aria-label="Breadcrumb" className="text-xs text-[#4a6366] mb-3 sm:mb-4">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/teams" className="text-[#075B5C] hover:underline">
                Teams
              </Link>
            </li>
            {conferenceLabel ? (
              <>
                <li aria-hidden className="text-[#DCE9EA]">
                  /
                </li>
                <li>{conferenceLabel}</li>
              </>
            ) : null}
            <li aria-hidden className="text-[#DCE9EA]">
              /
            </li>
            <li>
              <Link
                href={`/teams/${routeTeamId}`}
                className="text-[#075B5C] hover:underline"
              >
                {teamName}
              </Link>
            </li>
          </ol>
        </nav>

        <div className="min-w-0 text-center">
          <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.16em] text-[#8aa0a3]">
            {seasonLabel}
          </p>
          <h1 className="mt-1 w-full font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-extrabold tracking-tight text-[#063f46] leading-[0.9] uppercase">
            {teamName}
          </h1>
          <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs font-bold uppercase tracking-[0.14em] text-[#075B5C]">
            Preseason Preview
          </p>
          <p className="mt-2 mx-auto text-sm sm:text-base text-[#4a6366] max-w-2xl">
            {dek}
          </p>
        </div>
      </div>
    </header>
  );
}
