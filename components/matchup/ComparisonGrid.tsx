import type { SeasonComparisonRow } from '@/lib/pregame-matchup/overview';

export type ComparisonGridProps = {
  awayAbbr: string;
  homeAbbr: string;
  /** True when the model produced a sample for either season, even if a caller passes no rows. */
  available: boolean;
  /** 2025–26 sample label. */
  label: string | null;
  /** Current-season sample label. Null when only 2025–26 is shown. */
  currentLabel?: string | null;
  /** '2026–27' when current-season values lead the rows. */
  seasonLabel?: string | null;
  possessionNote: string | null;
  rows: SeasonComparisonRow[];
  historyNote: string | null;
  currentNote?: string | null;
};

/** Primary value, with the 2025–26 value underneath when the primary is this season. */
export function SeasonValue({ value, prior, align }: { value: string; prior?: string; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <div className="type-card-data break-words tabular-nums text-[#063f46]">{value}</div>
      {prior != null ? (
        <div className="type-metadata break-words tabular-nums" data-prior-value>
          <span className="sr-only">2025–26: </span>
          <span aria-hidden>’25–26 </span>
          {prior}
        </div>
      ) : null}
    </div>
  );
}

/** Team comparison. Leads with this season when it has a sample; values are already formatted. */
export function ComparisonGrid({
  awayAbbr,
  homeAbbr,
  available,
  label,
  currentLabel = null,
  seasonLabel = null,
  possessionNote,
  rows,
  historyNote,
  currentNote = null,
}: ComparisonGridProps) {
  const heading = seasonLabel ? 'Team Comparison' : '2025–26 Team Identity';
  return (
    <section id="section-comparison" className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }} aria-labelledby="team-identity" data-current-season={seasonLabel ? 'shown' : 'hidden'}>
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="team-identity" className="type-section-heading text-[#063f46]">
          {heading}
        </h2>
      </div>
      <div className="p-3">
        {available ? (
          <>
            {currentLabel ? <p className="type-metadata">{currentLabel}</p> : null}
            {label ? <p className="type-metadata">{currentLabel ? `Smaller figures: ${label}` : label}</p> : null}
            {currentNote ? <p className="type-secondary mt-2">{currentNote}</p> : null}
            {possessionNote ? <p className="type-secondary mt-2">{possessionNote}</p> : null}
            <div className="mt-4 min-w-0 border-y border-[#DCE9EA]">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)_minmax(0,1fr)] gap-2 py-2">
                <div className="type-metadata min-w-0 truncate text-right">{awayAbbr}</div>
                <div className="type-metadata min-w-0 truncate text-center">{seasonLabel ?? ''}</div>
                <div className="type-metadata min-w-0 truncate">{homeAbbr}</div>
              </div>
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-2 border-t border-[#DCE9EA] py-2.5"
                >
                  <SeasonValue value={row.away} prior={row.priorAway} align="right" />
                  <div className="type-secondary min-w-0 break-words text-center">{row.label}</div>
                  <SeasonValue value={row.home} prior={row.priorHome} align="left" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="type-secondary">{historyNote}</p>
        )}
      </div>
    </section>
  );
}
