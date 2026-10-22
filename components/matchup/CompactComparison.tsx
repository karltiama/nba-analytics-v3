import type { MatchupOverviewPresentation } from '@/lib/pregame-matchup/overview';

const scrollMargin = { scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' } as const;

type Comparison = MatchupOverviewPresentation['comparison'];

/** Four existing formatted rows. Labels sit above the values so they wrap at 320px. */
export function CompactComparison({
  awayAbbr,
  homeAbbr,
  comparison,
}: {
  awayAbbr: string;
  homeAbbr: string;
  comparison: Comparison;
}) {
  return (
    <section
      id="section-compact-comparison"
      className="min-w-0 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={scrollMargin}
      aria-labelledby="compact-comparison-heading"
      data-compact-comparison={comparison.available ? 'shown' : 'hidden'}
    >
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="compact-comparison-heading" className="type-section-heading text-[#063f46]">
          Supporting comparison
        </h2>
      </div>
      <div className="p-3">
        {comparison.available ? (
          <>
            {comparison.label ? <p className="type-metadata">{comparison.label}</p> : null}
            {comparison.possessionNote ? <p className="type-secondary mt-2 text-pretty">{comparison.possessionNote}</p> : null}
            <div className="mt-4 border-y border-[#DCE9EA]">
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="type-metadata min-w-0 truncate text-right">{awayAbbr}</div>
                <div className="type-metadata min-w-0 truncate">{homeAbbr}</div>
              </div>
              {comparison.rows.map((row) => (
                <div key={row.label} className="min-w-0 border-t border-[#DCE9EA] py-2.5">
                  <div className="type-secondary text-pretty text-center">{row.label}</div>
                  <div className="mt-1 grid grid-cols-2 gap-3">
                    <div className="type-card-data min-w-0 break-words text-right tabular-nums text-[#063f46]">{row.away}</div>
                    <div className="type-card-data min-w-0 break-words tabular-nums text-[#063f46]">{row.home}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="type-secondary mt-3">
              <a
                href="#section-comparison"
                className="type-interactive rounded-lg text-[#075B5C] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075B5C]"
              >
                Full team identity
              </a>
            </p>
          </>
        ) : (
          <p className="type-secondary text-pretty">{comparison.emptyNote}</p>
        )}
      </div>
    </section>
  );
}
