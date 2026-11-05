import type { MatchupQuote } from '@/lib/pregame-matchup/quote';
import { MIN_SERIES_POINTS, type MarketPoint } from '@/lib/pregame-matchup/odds-consensus';
import { RAIL_CARD, RAIL_HEADER } from '@/components/matchup/MatchupContextStrip';
import { LineMovementChart } from '@/components/betting/LineMovementChart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function etLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  }).format(new Date(iso));
}

/** Points for the shared LineMovementChart: one per odds pull, labelled in ET. */
export function chartPoints(series: MarketPoint[], value: (p: MarketPoint) => number | null): { time: string; value: number }[] {
  return series.flatMap((p) => {
    const v = value(p);
    return v == null ? [] : [{ time: etLabel(p.at), value: v }];
  });
}

/** Same tab styling as the game page's line movement. */
const TAB = 'type-interactive rounded text-cc-secondary data-[state=active]:bg-[#063f46]! data-[state=active]:text-white!';

/** Rail card: movement summary, the game page's spread/total line charts, and the best price per side. */
export function MarketMovement({ quote, homeAbbr }: { quote: MatchupQuote; homeAbbr: string }) {
  const series = quote.series ?? [];
  const [summary, moved] = (quote.movement ?? '').split(' Books that moved: ');
  const spread = chartPoints(series, (p) => p.spread);
  const total = chartPoints(series, (p) => p.total);
  const charted = spread.length >= MIN_SERIES_POINTS || total.length >= MIN_SERIES_POINTS;
  if (!quote.movement && !quote.best && !charted) return null;
  return (
    <section className={RAIL_CARD} aria-labelledby="market-movement" data-market-card>
      <div className={RAIL_HEADER}>
        <h2 id="market-movement" className="type-section-heading text-[#063f46]">
          Market
        </h2>
        <span className="type-metadata">Snapshots · not live</span>
      </div>
      <div className="space-y-3 p-3">
        {summary ? (
          <p className="type-secondary text-[#063f46]" data-market-movement>
            {summary}
          </p>
        ) : null}
        {charted ? (
          <div data-market-chart>
            <p className="type-metadata mb-2">Consensus after each odds pull</p>
            <Tabs defaultValue="spread" className="w-full">
              <TabsList className="mb-2 grid h-8 w-full grid-cols-2 rounded-lg bg-[#F8FBFA] p-1">
                <TabsTrigger value="spread" className={TAB}>
                  Spread ({homeAbbr})
                </TabsTrigger>
                <TabsTrigger value="total" className={TAB}>
                  Total (O/U)
                </TabsTrigger>
              </TabsList>
              <TabsContent value="spread" className="mt-0 min-w-0 overflow-hidden outline-none">
                <LineMovementChart
                  data={spread}
                  label={`Spread: ${homeAbbr}`}
                  color="#075B5C"
                  height={150}
                  width={320}
                  embedded
                  referenceCaption="First pull"
                  comparisonCaption="Latest"
                />
              </TabsContent>
              <TabsContent value="total" className="mt-0 min-w-0 overflow-hidden outline-none">
                <LineMovementChart
                  data={total}
                  label="Total (O/U)"
                  color="#20B95A"
                  height={150}
                  width={320}
                  embedded
                  referenceCaption="First pull"
                  comparisonCaption="Latest"
                />
              </TabsContent>
            </Tabs>
          </div>
        ) : series.length > 0 ? (
          <p className="type-metadata">Chart appears after {MIN_SERIES_POINTS} odds pulls; this game has {series.length}.</p>
        ) : null}
        {moved ? (
          <details>
            <summary className="type-interactive cursor-pointer text-[#075B5C]">Books that moved</summary>
            <p className="type-metadata mt-1">{moved}</p>
          </details>
        ) : null}
        {quote.best ? (
          <p className="type-metadata" data-market-best>
            {quote.best}
          </p>
        ) : null}
      </div>
    </section>
  );
}
