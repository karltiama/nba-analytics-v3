import type { MatchupOverviewPresentation } from '@/lib/pregame-matchup/overview';
import { SeasonValue } from '@/components/matchup/ComparisonGrid';
import { RAIL_CARD, RAIL_HEADER } from '@/components/matchup/MatchupContextStrip';

/** The four headline team rows, sized for the sidebar. The full table stays in the main column. */
export function MatchupQuickStats({
  awayAbbr,
  homeAbbr,
  comparison,
}: {
  awayAbbr: string;
  homeAbbr: string;
  comparison: MatchupOverviewPresentation['comparison'];
}) {
  return (
    <section
      id="section-quick-stats"
      className={RAIL_CARD}
      aria-labelledby="quick-stats-heading"
      data-quick-stats={comparison.available ? 'shown' : 'hidden'}
    >
      <div className={RAIL_HEADER}>
        <h2 id="quick-stats-heading" className="type-section-heading text-[#063f46]">
          At a glance
        </h2>
      </div>
      <div className="p-3">
        {comparison.available ? (
          <>
            {comparison.label ? <p className="type-metadata text-pretty">{comparison.label}</p> : null}
            <div className="mt-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)] gap-2 pb-1">
                <div className="type-metadata truncate text-right">{awayAbbr}</div>
                <div />
                <div className="type-metadata truncate">{homeAbbr}</div>
              </div>
              {comparison.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2 border-t border-[#DCE9EA] py-2"
                >
                  <SeasonValue value={row.away} prior={row.priorAway} align="right" />
                  <div className="type-secondary break-words text-center">{row.label}</div>
                  <SeasonValue value={row.home} prior={row.priorHome} align="left" />
                </div>
              ))}
            </div>
            <a
              href="#section-comparison"
              className="type-interactive mt-2 inline-block rounded-lg text-[#075B5C] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075B5C]"
            >
              Full comparison
            </a>
          </>
        ) : (
          <p className="type-secondary text-pretty">{comparison.emptyNote}</p>
        )}
      </div>
    </section>
  );
}
