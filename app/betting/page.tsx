'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Header,
  GameCard,
  PlayerCard,
  AIInsightPanel,
  BettingInsights,
  FilterBar,
  GameDetailsModal,
  type Game,
  type PlayerData,
  type Insight,
  type SortOption,
} from '@/components/betting';
import {
  GameCardSkeleton,
  PlayerCardSkeleton,
  BettingInsightsSkeleton,
  AIInsightPanelSkeleton,
} from '@/components/betting/skeletons';

// ================================
// DATA FETCHING
// ================================

interface ApiGame {
  id: string;
  gameDate: string;
  startTime: string;
  status: string;
  homeTeam: {
    id: string;
    name: string;
    abbreviation: string;
    record: string;
    offensiveRating: number;
    defensiveRating: number;
    pace: number;
    avgPoints: number;
    recentForm: Array<{
      game_id: string;
      result: 'W' | 'L';
      team_score: number;
      opponent_score: number;
      opponent_abbr: string;
    }>;
  };
  awayTeam: {
    id: string;
    name: string;
    abbreviation: string;
    record: string;
    offensiveRating: number;
    defensiveRating: number;
    pace: number;
    avgPoints: number;
    recentForm: Array<{
      game_id: string;
      result: 'W' | 'L';
      team_score: number;
      opponent_score: number;
      opponent_abbr: string;
    }>;
  };
  homeScore: number | null;
  awayScore: number | null;
  odds: {
    home: { moneyline: number; spread: number; spreadOdds: number };
    away: { moneyline: number; spread: number; spreadOdds: number };
    overUnder: number;
    overOdds: number;
    underOdds: number;
  };
}

interface ApiPlayer {
  id: string;
  name: string;
  team: string;
  teamAbbreviation: string;
  position: string;
  opponent: string;
  opponentAbbreviation: string;
  props: Array<{
    type: 'points' | 'rebounds' | 'assists' | 'threes';
    line: number;
    trend: 'over' | 'under';
    confidence: number;
    recentAvg: number;
    seasonAvg: number;
  }>;
  recentPoints: number[];
  recentRebounds: number[];
  recentAssists: number[];
  whyText: string;
  trendPercentage: number;
  trendDirection: 'up' | 'down';
}

// Transform API game to GameCard format
function transformGame(apiGame: ApiGame): Game {
  // Calculate implied probabilities and odds based on team ratings
  // This is placeholder logic - will be replaced with real odds data
  const homeRating = apiGame.homeTeam.offensiveRating - apiGame.awayTeam.defensiveRating;
  const awayRating = apiGame.awayTeam.offensiveRating - apiGame.homeTeam.defensiveRating;
  const ratingDiff = homeRating - awayRating;
  
  // Estimate spread from rating difference (rough approximation)
  const estimatedSpread = -Math.round(ratingDiff * 0.3 * 2) / 2;
  
  // Estimate total from average points
  const estimatedTotal = Math.round(
    (apiGame.homeTeam.avgPoints + apiGame.awayTeam.avgPoints) * 2
  ) / 2;
  
  // Calculate implied probabilities (simplified)
  const homeProb = Math.max(25, Math.min(75, 50 + ratingDiff * 2));
  const awayProb = 100 - homeProb;
  
  // Determine if it's a close matchup
  const isClose = Math.abs(homeProb - awayProb) < 10;
  
  // Determine favorite
  const isFavorite = homeProb > awayProb ? 'home' : 'away';

  return {
    id: apiGame.id,
    homeTeam: {
      name: apiGame.homeTeam.name,
      abbreviation: apiGame.homeTeam.abbreviation,
      record: apiGame.homeTeam.record,
    },
    awayTeam: {
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
      moneyline: homeProb > 50 ? Math.round(-100 * homeProb / (100 - homeProb)) : Math.round(100 * (100 - homeProb) / homeProb),
      spread: estimatedSpread,
      spreadOdds: -110,
    },
    awayOdds: {
      moneyline: awayProb > 50 ? Math.round(-100 * awayProb / (100 - awayProb)) : Math.round(100 * (100 - awayProb) / awayProb),
      spread: -estimatedSpread,
      spreadOdds: -110,
    },
    overUnder: estimatedTotal || 220,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: Math.round(homeProb),
    awayImpliedProb: Math.round(awayProb),
    isFavorite,
    isClose,
  };
}

// Transform API player to PlayerCard format
function transformPlayer(apiPlayer: ApiPlayer): PlayerData {
  return {
    id: apiPlayer.id,
    name: apiPlayer.name,
    team: apiPlayer.team,
    teamAbbreviation: apiPlayer.teamAbbreviation,
    position: apiPlayer.position,
    opponent: apiPlayer.opponent,
    opponentAbbreviation: apiPlayer.opponentAbbreviation,
    props: apiPlayer.props,
    recentPoints: apiPlayer.recentPoints,
    recentRebounds: apiPlayer.recentRebounds,
    recentAssists: apiPlayer.recentAssists,
    whyText: apiPlayer.whyText,
    trendPercentage: Math.round(apiPlayer.trendPercentage),
    trendDirection: apiPlayer.trendDirection,
  };
}

// Dummy game details for modal (will be replaced with API)
const createGameDetails = (game: Game) => ({
  homeTeamStats: {
    offensiveRating: 115.2,
    defensiveRating: 112.8,
    pace: 100.4,
    recentForm: [
      { opponent: 'OPP', result: 'W' as const, score: '118-105', spread: -6.5, covered: true },
      { opponent: 'OPP', result: 'W' as const, score: '124-112', spread: -8.0, covered: true },
      { opponent: 'OPP', result: 'L' as const, score: '108-115', spread: -5.5, covered: false },
      { opponent: 'OPP', result: 'W' as const, score: '121-110', spread: -3.5, covered: true },
      { opponent: 'OPP', result: 'W' as const, score: '117-112', spread: +1.5, covered: true },
    ],
  },
  awayTeamStats: {
    offensiveRating: 114.8,
    defensiveRating: 110.2,
    pace: 101.2,
    recentForm: [
      { opponent: 'OPP', result: 'W' as const, score: '122-115', spread: -2.5, covered: true },
      { opponent: 'OPP', result: 'L' as const, score: '105-112', spread: -4.0, covered: false },
      { opponent: 'OPP', result: 'W' as const, score: '118-109', spread: +1.5, covered: true },
      { opponent: 'OPP', result: 'W' as const, score: '130-118', spread: -7.5, covered: true },
      { opponent: 'OPP', result: 'L' as const, score: '108-115', spread: +2.5, covered: false },
    ],
  },
  spreadMovement: [
    { time: 'Open', value: game.homeOdds.spread - 1 },
    { time: '10am', value: game.homeOdds.spread - 0.5 },
    { time: '12pm', value: game.homeOdds.spread - 0.5 },
    { time: '2pm', value: game.homeOdds.spread },
    { time: '4pm', value: game.homeOdds.spread },
    { time: 'Now', value: game.homeOdds.spread },
  ],
  totalMovement: [
    { time: 'Open', value: game.overUnder + 2.5 },
    { time: '10am', value: game.overUnder + 2 },
    { time: '12pm', value: game.overUnder + 1 },
    { time: '2pm', value: game.overUnder + 0.5 },
    { time: '4pm', value: game.overUnder },
    { time: 'Now', value: game.overUnder },
  ],
  historicalMatchups: [],
  injuries: { home: [], away: [] },
  aiSuggestions: [
    {
      type: 'Spread' as const,
      pick: `${game.homeTeam.abbreviation} ${game.homeOdds.spread}`,
      confidence: 65,
      explanation: 'Based on recent form and team ratings analysis.',
    },
    {
      type: 'O/U' as const,
      pick: game.overUnder > 220 ? `Under ${game.overUnder}` : `Over ${game.overUnder}`,
      confidence: 60,
      explanation: 'Combined pace and efficiency metrics suggest this total.',
    },
  ],
  aiConfidenceScores: {
    moneyline: 65,
    spread: 62,
    total: 58,
  },
});

// ================================
// MAIN COMPONENT
// ================================

export default function BettingDashboard() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('time');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showCloseMatchups, setShowCloseMatchups] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Data states
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [widgets, setWidgets] = useState<any[]>([]);
  
  // Loading states
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set initial date on mount to avoid hydration mismatch
  useEffect(() => {
    setSelectedDate(new Date());
    setMounted(true);
  }, []);

  // Apply dark mode class to html element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Fetch today's games
  const fetchGames = useCallback(async () => {
    setLoadingGames(true);
    try {
      const res = await fetch('/api/betting/games');
      if (!res.ok) throw new Error('Failed to fetch games');
      const data = await res.json();
      const transformedGames = data.games.map(transformGame);
      setGames(transformedGames);
    } catch (err: any) {
      console.error('Error fetching games:', err);
      setError(err.message);
    } finally {
      setLoadingGames(false);
    }
  }, []);

  // Fetch players
  const fetchPlayers = useCallback(async () => {
    setLoadingPlayers(true);
    try {
      const res = await fetch('/api/betting/players/trending?limit=8');
      if (!res.ok) throw new Error('Failed to fetch players');
      const data = await res.json();
      const transformedPlayers = data.players.map(transformPlayer);
      setPlayers(transformedPlayers);
    } catch (err: any) {
      console.error('Error fetching players:', err);
    } finally {
      setLoadingPlayers(false);
    }
  }, []);

  // Fetch insights
  const fetchInsights = useCallback(async () => {
    setLoadingInsights(true);
    try {
      const res = await fetch('/api/betting/insights');
      if (!res.ok) throw new Error('Failed to fetch insights');
      const data = await res.json();
      setInsights(data.insights || []);
      setWidgets(data.widgets || []);
    } catch (err: any) {
      console.error('Error fetching insights:', err);
    } finally {
      setLoadingInsights(false);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchGames();
    fetchPlayers();
    fetchInsights();
  }, [fetchGames, fetchPlayers, fetchInsights]);

  // Filter games
  const filteredGames = games.filter(game => {
    const matchesSearch = searchValue === '' || 
      game.homeTeam.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.awayTeam.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.homeTeam.abbreviation.toLowerCase().includes(searchValue.toLowerCase()) ||
      game.awayTeam.abbreviation.toLowerCase().includes(searchValue.toLowerCase());
    
    const matchesClose = !showCloseMatchups || game.isClose;
    
    return matchesSearch && matchesClose;
  });

  // Sort games
  const sortedGames = [...filteredGames].sort((a, b) => {
    switch (sortBy) {
      case 'spread':
        return Math.abs(a.homeOdds.spread) - Math.abs(b.homeOdds.spread);
      case 'total':
        return b.overUnder - a.overUnder;
      case 'probability':
        return Math.max(b.homeImpliedProb, b.awayImpliedProb) - Math.max(a.homeImpliedProb, a.awayImpliedProb);
      default:
        return 0;
    }
  });

  const selectedGame = selectedGameId ? games.find(g => g.id === selectedGameId) : null;

  const isLoading = loadingGames || loadingPlayers || loadingInsights;

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      <Header
        selectedDate={selectedDate || new Date()}
        onDateChange={setSelectedDate}
        isDarkMode={isDarkMode}
        onThemeToggle={() => setIsDarkMode(!isDarkMode)}
      />

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Filter Bar */}
            <FilterBar
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              sortBy={sortBy}
              onSortChange={setSortBy}
              showFavoritesOnly={showFavoritesOnly}
              onFavoritesToggle={() => setShowFavoritesOnly(!showFavoritesOnly)}
              showCloseMatchups={showCloseMatchups}
              onCloseMatchupsToggle={() => setShowCloseMatchups(!showCloseMatchups)}
            />

            {/* Error State */}
            {error && (
              <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757]">
                <p className="text-sm text-[#ff4757]">Error loading data: {error}</p>
                <button 
                  onClick={() => { setError(null); fetchGames(); }}
                  className="mt-2 text-xs text-[#00d4ff] hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Today's Games */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Today&apos;s Games</h2>
                <span className="text-xs text-muted-foreground">
                  {loadingGames ? 'Loading...' : `${sortedGames.length} games scheduled`}
                </span>
              </div>
              
              {loadingGames ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <GameCardSkeleton key={i} />
                  ))}
                </div>
              ) : sortedGames.length === 0 ? (
                <div className="glass-card rounded-xl p-8 text-center">
                  <p className="text-muted-foreground">No games scheduled for today</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">Check back later or select a different date</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedGames.map((game, index) => (
                    <div key={game.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                      <GameCard
                        game={game}
                        onViewDetails={setSelectedGameId}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Betting Insights */}
            <section>
              {loadingInsights ? (
                <BettingInsightsSkeleton />
              ) : widgets.length > 0 ? (
                <BettingInsights widgets={widgets} />
              ) : null}
            </section>

            {/* Players to Watch */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Players to Watch</h2>
                  <p className="text-xs text-muted-foreground">Players with significant L5 vs Season trends</p>
                </div>
                <span className="text-[10px] px-2 py-1 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full font-medium">
                  DATA-DRIVEN
                </span>
              </div>
              
              {loadingPlayers ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <PlayerCardSkeleton key={i} />
                  ))}
                </div>
              ) : players.length === 0 ? (
                <div className="glass-card rounded-xl p-8 text-center">
                  <p className="text-muted-foreground">No trending players found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {players.map((player, index) => (
                    <div key={player.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                      <PlayerCard player={player} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* AI Insights Sidebar */}
          <aside className="w-full xl:w-80 shrink-0">
            <div className="sticky top-20">
              {loadingInsights ? (
                <AIInsightPanelSkeleton />
              ) : (
                <AIInsightPanel insights={insights} />
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* Game Details Modal */}
      {selectedGame && (
        <GameDetailsModal
          data={{
            game: selectedGame,
            ...createGameDetails(selectedGame),
          }}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </div>
  );
}
