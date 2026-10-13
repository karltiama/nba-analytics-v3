import type { ComparisonRow } from '@/lib/pregame-matchup/compose';

export type ComparisonGridProps = {
  awayAbbr: string;
  homeAbbr: string;
  /** True when the model produced a historical sample, even if a caller passes no rows. */
  available: boolean;
  label: string | null;
  possessionNote: string | null;
  rows: ComparisonRow[];
  historyNote: string | null;
};

/** 2025–26 comparison rows. Values are already formatted by the matchup model. */
export function ComparisonGrid({
  awayAbbr,
  homeAbbr,
  available,
  label,
  possessionNote,
  rows,
  historyNote,
}: ComparisonGridProps) {
  return (
    <section id="section-comparison" className="scroll-mt-36 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" aria-labelledby="team-identity">
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="team-identity" className="type-section-heading text-[#063f46]">
          2025–26 Team Identity
        </h2>
      </div>
      <div className="p-3">
        {available ? (
          <>
            {label ? <p className="type-metadata">{label}</p> : null}
            {possessionNote ? <p className="type-secondary mt-2">{possessionNote}</p> : null}
            <div className="mt-4 border-y border-[#DCE9EA]">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,9.5rem)_minmax(0,1fr)] gap-2 py-2">
                <div className="type-metadata text-right">{awayAbbr}</div>
                <div />
                <div className="type-metadata">{homeAbbr}</div>
              </div>
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,9.5rem)_minmax(0,1fr)] gap-2 border-t border-[#DCE9EA] py-2.5"
                >
                  <div className="type-card-data text-right tabular-nums text-[#063f46]">{row.away}</div>
                  <div className="type-secondary text-center">{row.label}</div>
                  <div className="type-card-data tabular-nums text-[#063f46]">{row.home}</div>
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
