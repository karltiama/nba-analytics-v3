import Link from 'next/link';

export const DEVELOPER_SITE_URL = 'https://www.karltiama.dev';
export const PROBLEM_GAMBLING_URL = 'https://www.ncpgambling.org';

/**
 * Site-wide footer: responsible-gambling disclaimer, attribution, copyright and
 * the developer link. Used by the landing page, the marketing 404 and every
 * page inside BettingAppShell. Copy approved by Karl on 2026-11-12; keep it
 * plain (no edge, guaranteed-money or winning-pick claims).
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const linkClass =
    'underline underline-offset-2 decoration-white/40 hover:decoration-[#55ddb1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55ddb1] rounded-sm';

  return (
    <footer className="relative z-10 mt-auto bg-[#063f46] text-white" data-site-footer>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2 min-w-0 w-fit" aria-label="Court Context home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/court-context-logo.png" alt="" className="h-8 w-auto" />
            <span className="font-bold tracking-tight">Court Context</span>
          </Link>
          <a
            href={DEVELOPER_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm text-white/80 w-fit ${linkClass}`}
          >
            Built by Karl Tiama
          </a>
        </div>

        <p className="text-sm leading-6 text-white/80 max-w-3xl">
          Court Context provides NBA history, stats and context for research and entertainment only. It is not
          betting, financial or investment advice, and nothing here guarantees winnings or profit. Court Context is
          not a sportsbook and does not accept wagers. You must be of legal betting age (21+ in most US states) and
          follow your local laws. If you or someone you know has a gambling problem, call{' '}
          <a href="tel:18004262537" className={`font-semibold text-white whitespace-nowrap ${linkClass}`}>
            1-800-GAMBLER
          </a>{' '}
          or visit{' '}
          <a href={PROBLEM_GAMBLING_URL} target="_blank" rel="noopener noreferrer" className={`text-white ${linkClass}`}>
            ncpgambling.org
          </a>
          .
        </p>

        <div className="border-t border-white/15 pt-4 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6 text-xs leading-5 text-white/70">
          <p>© {year} Court Context. All rights reserved.</p>
          <p>Stats and odds data from BallDontLie.</p>
          <p>Not affiliated with or endorsed by the NBA or its teams.</p>
        </div>
      </div>
    </footer>
  );
}
