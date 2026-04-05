'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy } from 'lucide-react';
import { GameCard, getTodayET, type Game } from '@/components/betting';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';
import { GameCardSkeleton } from '@/components/betting/skeletons';

// Reuse the transformation logic from the main betting page
interface ApiGame {
  id: string;
  gameDate: string;
  startTime: string;
  status: string;
  homeTeam: any;
  awayTeam: any;
  homeScore: number | null;
  awayScore: number | null;
  odds: any;
}

function transformGame(apiGame: ApiGame): Game {
  const odds = apiGame.odds;
  const homeProb = odds.home.moneyline 
    ? odds.home.moneyline > 0 
      ? 100 / (odds.home.moneyline + 100) * 100
      : Math.abs(odds.home.moneyline) / (Math.abs(odds.home.moneyline) + 100) * 100
    : 50;
  const awayProb = odds.away.moneyline
    ? odds.away.moneyline > 0
      ? 100 / (odds.away.moneyline + 100) * 100
      : Math.abs(odds.away.moneyline) / (Math.abs(odds.away.moneyline) + 100) * 100
    : 50;
  
  const isClose = Math.abs(homeProb - awayProb) < 10;
  const isFavorite = homeProb > awayProb ? 'home' : 'away';

  const homePace = apiGame.homeTeam.pace || 0;
  const awayPace = apiGame.awayTeam.pace || 0;
  const projectedPace = homePace && awayPace ? (homePace + awayPace) / 2 : 0;
  const paceSignal = projectedPace > 0
    ? {
        label: projectedPace >= 102 ? 'FAST' : projectedPace <= 98 ? 'SLOW' : 'AVG',
        projected: projectedPace,
      }
    : undefined;

  const homeDef = apiGame.homeTeam.defensiveRating || 0;
  const awayDef = apiGame.awayTeam.defensiveRating || 0;
  let weakness: Game['weakness'] | undefined;
  if (homeDef > 0 && awayDef > 0) {
    const worseTeam = homeDef > awayDef ? apiGame.homeTeam : apiGame.awayTeam;
    const worseRank = homeDef > awayDef
      ? apiGame.homeTeam.defensiveRank
      : apiGame.awayTeam.defensiveRank;
    if (worseRank > 0) {
      weakness = {
        label: 'Def Rtg',
        team: worseTeam.abbreviation,
        rank: worseRank,
      };
    }
  }

  return {
    id: apiGame.id,
    homeTeam: {
      id: apiGame.homeTeam.id,
      name: apiGame.homeTeam.name,
      abbreviation: apiGame.homeTeam.abbreviation,
      record: apiGame.homeTeam.record,
    },
    awayTeam: {
      id: apiGame.awayTeam.id,
      name: apiGame.awayTeam.name,
      abbreviation: apiGame.awayTeam.abbreviation,
      record: apiGame.awayTeam.record,
    },
    startTime: new Date(apiGame.startTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
    homeOdds: {
      moneyline: odds.home.moneyline || 0,
      spread: odds.home.spread || 0,
      spreadOdds: odds.home.spreadOdds || 0,
    },
    awayOdds: {
      moneyline: odds.away.moneyline || 0,
      spread: odds.away.spread || 0,
      spreadOdds: odds.away.spreadOdds || 0,
    },
    overUnder: odds.overUnder || 0,
    overOdds: odds.overOdds || 0,
    underOdds: odds.underOdds || 0,
    homeImpliedProb: Math.round(homeProb),
    awayImpliedProb: Math.round(awayProb),
    isFavorite,
    isClose,
    paceSignal,
    weakness,
    status: apiGame.status || undefined,
    homeScore: apiGame.homeScore ?? undefined,
    awayScore: apiGame.awayScore ?? undefined,
  };
}

export function FeaturedGames() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFeaturedGames() {
      try {
        const today = getTodayET();
        const res = await fetch(`/api/betting/games?date=${today}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        // Limit to 3 games for the featured section
        const transformed = (data.games || []).slice(0, 3).map(transformGame);
        setGames(transformed);
      } catch (err) {
        console.error('Error fetching featured games:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchFeaturedGames();
  }, []);

  if (!loading && games.length === 0) return null;

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
        description="Live odds and predictive analysis for the slate"
        href="/betting"
        linkLabel="View Full Terminal"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          [...Array(3)].map((_, i) => <GameCardSkeleton key={i} />)
        ) : (
          games.map((game, index) => (
            <div 
              key={game.id} 
              className="fade-in" 
              style={{ animationDelay: `${index * 150}ms` }}
            >
              <GameCard game={game} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
