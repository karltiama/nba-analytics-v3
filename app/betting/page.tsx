'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  GameCard,
  AIInsightPanel,
  BettingInsights,
  FilterBar,
  getTodayET,
  getDateLabel,
  TrendingPlayerStrip,
  type Game,
  type Insight,
  type SortOption,
} from '@/components/betting';
import {
  GameCardSkeleton,
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
    defensiveRank: number;
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
    defensiveRank: number;
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
    bookmaker?: string | null; // Which bookmaker these odds are from
  };
}

// Transform API game to GameCard format
function transformGame(apiGame: ApiGame): Game {
  // Use real odds from API (from markets table)
  const odds = apiGame.odds;
  
  // Calculate implied probabilities from real moneyline odds
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
  
  // Determine if it's a close matchup
  const isClose = Math.abs(homeProb - awayProb) < 10;
  
  // Determine favorite
  const isFavorite = homeProb > awayProb ? 'home' : 'away';

  // Pace signal (computed from real team pace values when available)
  const homePace = apiGame.homeTeam.pace || 0;
  const awayPace = apiGame.awayTeam.pace || 0;
  const projectedPace = homePace && awayPace ? (homePace + awayPace) / 2 : 0;
  const paceSignal = projectedPace > 0
    ? {
        label: projectedPace >= 102 ? 'FAST' : projectedPace <= 98 ? 'SLOW' : 'AVG',
        projected: projectedPace,
      }
    : undefined;

  // Weakness indicator: pick whichever team has worse defensive rating (higher = worse)
  // Uses real league-wide RANK from the API (1 = best, 30 = worst)
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

// ================================
// MAIN COMPONENT
// ================================

type PageProps = {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default function BettingDashboard(props: PageProps) {
  // Unwrap Next.js 16 async params/searchParams so dev overlay doesn't enumerate them
  if (props.params) use(props.params);
  if (props.searchParams) use(props.searchParams);

  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchValue, setSearchValue] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('time');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showCloseMatchups, setShowCloseMatchups] = useState(false);

  // Selected date from URL (ET, YYYY-MM-DD); default today
  const selectedDate = useMemo(() => {
    const date = searchParams.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return getTodayET();
  }, [searchParams]);

  // Data states
  const [games, setGames] = useState<Game[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [widgets, setWidgets] = useState<any[]>([]);
  const [slateSummary, setSlateSummary] = useState<string | null>(null);
  const [slateSummaryHint, setSlateSummaryHint] = useState<string | null>(null);

  // Loading states
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [slateSummaryLoading, setSlateSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch games for a given date
  const fetchGames = useCallback(async (date: string) => {
    setLoadingGames(true);
    setError(null);
    try {
      const res = await fetch(`/api/betting/games?date=${encodeURIComponent(date)}`);
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

  // Update URL when date changes (shareable link)
  const handleDateChange = useCallback(
    (date: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', date);
      router.replace(`/betting?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Optional: sync URL to today when no date param (so default view is shareable)
  useEffect(() => {
    if (!searchParams.get('date')) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', getTodayET());
      router.replace(`/betting?${params.toString()}`, { scroll: false });
    }
  }, []); // run once on mount

  // Refetch games when selected date changes
  useEffect(() => {
    fetchGames(selectedDate);
  }, [selectedDate, fetchGames]);

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

  // League-wide stat cards / highlights (not tied to calendar date)
  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  useEffect(() => {
    const ac = new AbortController();
    setSlateSummaryLoading(true);
    setSlateSummaryHint(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/betting/ai-slate-insights?date=${encodeURIComponent(selectedDate)}`,
          { signal: ac.signal }
        );
        const data = await res.json();
        if (data.summary && typeof data.summary === 'string') {
          setSlateSummary(data.summary);
          setSlateSummaryHint(null);
        } else {
          setSlateSummary(null);
          setSlateSummaryHint(
            typeof data.message === 'string'
              ? data.message
              : data.code === 'NO_OPENAI_KEY'
                ? 'Add OPENAI_API_KEY on the server to enable the slate summary.'
                : data.code === 'OPENAI_ERROR'
                  ? 'OpenAI request failed. Try again later.'
                  : 'Summary unavailable.'
          );
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error('Error fetching AI slate insights:', e);
        setSlateSummary(null);
        setSlateSummaryHint('Could not load slate summary.');
      } finally {
        if (!ac.signal.aborted) {
          setSlateSummaryLoading(false);
        }
      }
    })();

    return () => ac.abort();
  }, [selectedDate]);

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

  const dateLabel = getDateLabel(selectedDate);
  const gamesSectionTitle =
    dateLabel === 'Today'
      ? "Today's Games"
      : dateLabel === 'Yesterday'
        ? "Yesterday's Games"
        : `Games for ${dateLabel}`;

  const emptyGamesMessage =
    dateLabel === 'Today'
      ? 'No games scheduled for today'
      : dateLabel === 'Yesterday'
        ? 'No games yesterday'
        : `No games on ${dateLabel}`;

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pb-6">
        <div className="flex flex-col xl:flex-row gap-6">
          {/* Main Content */}
          <div className="flex-1 min-w-0 pt-8 space-y-6">
            {/* Date + Filters (single bar) */}
            <FilterBar
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              sortBy={sortBy}
              onSortChange={setSortBy}
              showFavoritesOnly={showFavoritesOnly}
              onFavoritesToggle={() => setShowFavoritesOnly(!showFavoritesOnly)}
              showCloseMatchups={showCloseMatchups}
              onCloseMatchupsToggle={() => setShowCloseMatchups(!showCloseMatchups)}
              selectedDate={selectedDate}
              onDateChange={handleDateChange}
            />

            {/* Error State */}
            {error && (
              <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757]">
                <p className="text-sm text-[#ff4757]">Error loading data: {error}</p>
                <button 
                  onClick={() => { setError(null); fetchGames(selectedDate); }}
                  className="mt-2 text-xs text-[#00d4ff] hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Trending Players Strip */}
            <TrendingPlayerStrip />

            {/* Games for selected date */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">{gamesSectionTitle}</h2>
                <span className="text-xs text-muted-foreground">
                  {loadingGames ? 'Loading...' : `${sortedGames.length} games`}
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
                  <p className="text-muted-foreground">{emptyGamesMessage}</p>
                  {dateLabel === 'Today' && (
                    <p className="text-xs text-muted-foreground/60 mt-2">Check back later or select a different date</p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedGames.map((game, index) => (
                    <div key={game.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                      <GameCard game={game} />
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
          </div>

          {/* AI Insights Sidebar — no self-start so it stretches; sticky then has room to stick */}
          <aside className="w-full xl:w-80 shrink-0">
            <div className="sticky top-16 pt-8 pb-6">
              <AIInsightPanel
                insights={insights}
                slateSummary={slateSummary}
                slateSummaryLoading={slateSummaryLoading}
                slateSummaryHint={slateSummaryHint}
              />
            </div>
          </aside>
        </div>
    </main>
  );
}
