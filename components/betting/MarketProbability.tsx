'use client';

/**
 * Sportsbook two-way implied probability, vig-removed for display.
 * Not a Court Context win probability.
 */

export function MarketProbability({
  awayAbbr,
  homeAbbr,
  awayPct,
  homePct,
}: {
  awayAbbr: string;
  homeAbbr: string;
  awayPct: number;
  homePct: number;
}) {
  return (
    <div>
      <p className="type-secondary mb-2 text-center">Market implied probability</p>
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 text-left">
          <div className="type-metadata leading-none">{awayAbbr}</div>
          <div className="type-card-data mt-0.5 tabular-nums text-[#063F46]">{awayPct}%</div>
        </div>
        <div
          className="flex-1 flex h-2 bg-[#E8F0F1] rounded-full overflow-hidden min-w-0"
          role="img"
          aria-label={`Market implied probability: ${awayAbbr} ${awayPct} percent, ${homeAbbr} ${homePct} percent`}
        >
          <div
            className="h-full rounded-l-full bg-[#168DD8] min-w-0"
            style={{ flex: awayPct }}
          />
          <div
            className="h-full rounded-r-full bg-[#20B95A] min-w-0"
            style={{ flex: homePct }}
          />
        </div>
        <div className="text-right shrink-0">
          <div className="type-metadata leading-none">{homeAbbr}</div>
          <div className="type-card-data mt-0.5 tabular-nums text-[#063F46]">{homePct}%</div>
        </div>
      </div>
    </div>
  );
}
