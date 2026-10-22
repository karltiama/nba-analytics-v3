import type { OverviewPersonnel } from '@/lib/pregame-matchup/overview';

const scrollMargin = { scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' } as const;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Returning-minutes summary. The full continuity section stays further down the page. */
export function PersonnelSummary({ personnel }: { personnel: OverviewPersonnel }) {
  const shown = personnel.status === 'shown' && personnel.shares.length > 0;
  return (
    <section
      id="section-personnel"
      className="min-w-0 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm"
      style={scrollMargin}
      aria-labelledby="personnel-summary-heading"
      data-personnel={personnel.status}
    >
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="personnel-summary-heading" className="type-section-heading text-[#063f46]">
          Personnel context
        </h2>
      </div>
      <div className="space-y-3 p-3">
        {shown ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {personnel.shares.map((team) => (
              <div key={team.abbr} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="type-metadata min-w-0 truncate">{team.abbr}</span>
                  <span className="type-card-data shrink-0 tabular-nums text-[#063f46]">
                    {team.minutesShare == null || !Number.isFinite(team.minutesShare) ? '—' : pct(team.minutesShare)}
                  </span>
                </div>
                <p className="type-secondary">Returning minutes, 2025–26</p>
                {team.concentration ? <p className="type-secondary mt-1 text-pretty">{team.concentration}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
        <p className="type-secondary text-pretty">{personnel.note}</p>
        <a
          href="#section-roster"
          className="type-interactive inline-block rounded-lg text-[#075B5C] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075B5C]"
        >
          Roster detail
        </a>
      </div>
    </section>
  );
}
