'use client';

import { Trophy } from 'lucide-react';
import { GameCard, type Game } from '@/components/betting';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';

/**
 * Public landing preview — static demo cards only.
 * Live slate data lives behind authenticated `/api/betting/games`
 * (Phase 1A.1). Do not call private betting APIs from this component.
 */
const DEMO_GAMES: Game[] = [
  {
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
    homeImpliedProb: 59,
    awayImpliedProb: 44,
    isFavorite: 'home',
    isClose: false,
    paceSignal: { label: 'AVG', projected: 97.4 },
  },
  {
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
    homeImpliedProb: 62,
    awayImpliedProb: 43,
    isFavorite: 'home',
    isClose: false,
    paceSignal: { label: 'FAST', projected: 99.0 },
  },
  {
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
    homeImpliedProb: 52,
    awayImpliedProb: 52,
    isFavorite: 'home',
    isClose: true,
    paceSignal: { label: 'FAST', projected: 100.1 },
  },
];

export function FeaturedGames() {
  return (
    <section
      className="w-full max-w-6xl mx-auto mt-32 px-4 sm:px-6"
      aria-labelledby="landing-featured-games-heading"
    >
      <LandingSectionHeader
        id="landing-featured-games-heading"
        icon={Trophy}
        accent="lime"
        title="Today's Matchups"
        description="Sample slate preview — sign in for live odds and analysis"
        href="/betting"
        linkLabel="View Full Terminal"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {DEMO_GAMES.map((game, index) => (
          <div
            key={game.id}
            className="fade-in"
            style={{ animationDelay: `${index * 150}ms` }}
          >
            <GameCard game={game} />
          </div>
        ))}
      </div>
    </section>
  );
}
