'use client';

import { Trophy } from 'lucide-react';
import { GameCard, type Game } from '@/components/betting';
import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import { LandingSection } from '@/components/landing/LandingSection';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';

function withMarketDisplay(
  game: Omit<Game, 'homeImpliedProb' | 'awayImpliedProb' | 'isFavorite' | 'isClose'>
): Game {
  const market = twoWayMarketDisplay(game.awayOdds.moneyline, game.homeOdds.moneyline);
  return {
    ...game,
    homeImpliedProb: market?.homePct ?? null,
    awayImpliedProb: market?.awayPct ?? null,
    isFavorite: market?.favorite ?? null,
    isClose: market?.isClose ?? false,
  };
}

/**
 * Public landing preview — static demo cards only.
 * Live slate data lives behind authenticated `/api/betting/games`
 * (Phase 1A.1). Do not call private betting APIs from this component.
 */
const DEMO_GAMES: Game[] = [
  withMarketDisplay({
    id: 'demo-1',
    homeTeam: {
      id: 'bos',
      name: 'Boston Celtics',
      abbreviation: 'BOS',
      record: '64-18',
    },
    awayTeam: {
      id: 'nyk',
      name: 'New York Knicks',
      abbreviation: 'NYK',
      record: '50-32',
    },
    startTime: '7:30 PM ET',
    homeOdds: { moneyline: -145, spread: -3.5, spreadOdds: -110 },
    awayOdds: { moneyline: 125, spread: 3.5, spreadOdds: -110 },
    overUnder: 224.5,
    overOdds: -110,
    underOdds: -110,
    matchupContext:
      'Boston has rest advantage. NYK enters on the second night of a back-to-back.',
  }),
  withMarketDisplay({
    id: 'demo-2',
    homeTeam: {
      id: 'okc',
      name: 'Oklahoma City Thunder',
      abbreviation: 'OKC',
      record: '68-14',
    },
    awayTeam: {
      id: 'den',
      name: 'Denver Nuggets',
      abbreviation: 'DEN',
      record: '50-32',
    },
    startTime: '9:00 PM ET',
    homeOdds: { moneyline: -160, spread: -4.5, spreadOdds: -110 },
    awayOdds: { moneyline: 135, spread: 4.5, spreadOdds: -110 },
    overUnder: 228.0,
    overOdds: -108,
    underOdds: -112,
    matchupContext:
      'OKC has rest advantage. DEN enters on the second night of a back-to-back.',
  }),
  withMarketDisplay({
    id: 'demo-3',
    homeTeam: {
      id: 'lal',
      name: 'Los Angeles Lakers',
      abbreviation: 'LAL',
      record: '50-32',
    },
    awayTeam: {
      id: 'gsw',
      name: 'Golden State Warriors',
      abbreviation: 'GSW',
      record: '48-34',
    },
    startTime: '10:00 PM ET',
    homeOdds: { moneyline: -110, spread: -1.5, spreadOdds: -110 },
    awayOdds: { moneyline: -110, spread: 1.5, spreadOdds: -110 },
    overUnder: 231.5,
    overOdds: -110,
    underOdds: -110,
    matchupContext:
      'Usage shift for Dončić. Scoring and assists rise when Reaves is out.',
  }),
];

export function FeaturedGames({
  games = DEMO_GAMES,
  description = 'Illustration only — not today’s live slate. Sign in to research historical props and parlays.',
}: {
  games?: Game[];
  description?: string;
} = {}) {
  return (
    <LandingSection aria-labelledby="landing-featured-games-heading">
      <LandingSectionHeader
        id="landing-featured-games-heading"
        icon={Trophy}
        accent="lime"
        variant="watermark"
        title="Sample matchups"
        description={description}
        href="/dashboard"
        linkLabel="Open dashboard"
        action="open_dashboard"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {games.map((game, index) => (
          <div
            key={game.id}
            className="fade-in"
            style={{ animationDelay: `${index * 150}ms` }}
          >
            <GameCard game={game} samplePreview />
          </div>
        ))}
      </div>
    </LandingSection>
  );
}
