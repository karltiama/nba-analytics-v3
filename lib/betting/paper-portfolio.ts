export type PaperPortfolioBet = {
  result: string | null;
  profitUnits: number | null;
  stakeUnits: number;
};

export type PaperPortfolioSummary = {
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  profitStaked: number;
  stakeStaked: number;
  roi: number | null;
};

/** Settled-only ROI/record. Caller must pass only the authenticated owner's bets. */
export function summarizeSettledPaperPortfolio(bets: PaperPortfolioBet[]): PaperPortfolioSummary {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let profitStaked = 0;
  let stakeStaked = 0;
  for (const b of bets) {
    stakeStaked += b.stakeUnits;
    if (b.result === 'win') wins++;
    else if (b.result === 'loss') losses++;
    else if (b.result === 'push') pushes++;
    else if (b.result === 'void') voids++;
    profitStaked += b.profitUnits ?? 0;
  }
  const roi = stakeStaked > 0 ? profitStaked / stakeStaked : null;
  return {
    n: bets.length,
    wins,
    losses,
    pushes,
    voids,
    profitStaked,
    stakeStaked,
    roi,
  };
}
