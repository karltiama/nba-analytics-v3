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
      <p className="text-[10px] uppercase tracking-wide font-medium text-[#72869A] text-center mb-2">
        Market Implied Probability
      </p>
      <div className="flex items-center gap-2.5">
        <div className="text-left shrink-0">
          <div className="text-xs font-medium text-[#72869A] leading-none">{awayAbbr}</div>
          <div className="text-sm font-bold text-[#063F46] tabular-nums mt-0.5">{awayPct}%</div>
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
          <div className="text-xs font-medium text-[#72869A] leading-none">{homeAbbr}</div>
          <div className="text-sm font-bold text-[#063F46] tabular-nums mt-0.5">{homePct}%</div>
        </div>
      </div>
    </div>
  );
}
