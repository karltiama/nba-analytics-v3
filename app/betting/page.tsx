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
  UnauthorizedPanel,
  type Game,
  type Insight,
  type SortOption,
} from '@/components/betting';
import {
  GameCardSkeleton,
  BettingInsightsSkeleton,
  AIInsightPanelSkeleton,
} from '@/components/betting/skeletons';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';

// ================================
// DATA FETCHING
// ================================

interface ApiGame {
  id: string;
  gameDate: string;
  startTime: string;
  status: string;
  statusRaw?: string | null;
  homeTeam: {
    id: string;
    name: string;
    abbreviation: string;
    record: string | null;
    offensiveRating: number | null;
    defensiveRating: number | null;
    defensiveRank: number | null;
    pace: number | null;
    avgPoints: number | null;
    hasSeasonAnalytics?: boolean;
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
    record: string | null;
    offensiveRating: number | null;
    defensiveRating: number | null;
    defensiveRank: number | null;
    pace: number | null;
    avgPoints: number | null;
    hasSeasonAnalytics?: boolean;
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
    home: { moneyline: number | null; spread: number | null; spreadOdds: number | null };
    away: { moneyline: number | null; spread: number | null; spreadOdds: number | null };
    overUnder: number | null;
    overOdds: number | null;
    underOdds: number | null;
    bookmaker?: string | null;
  };
}

function impliedProbFromMoneyline(ml: number | null): number | null {
  if (ml == null || !Number.isFinite(ml) || ml === 0) return null;
  if (ml > 0) return (100 / (ml + 100)) * 100;
  return (Math.abs(ml) / (Math.abs(ml) + 100)) * 100;
}

// Transform API game to GameCard format
function transformGame(apiGame: ApiGame): Game {
  const odds = apiGame.odds;
  const homeProb = impliedProbFromMoneyline(odds.home.moneyline);
  const awayProb = impliedProbFromMoneyline(odds.away.moneyline);
  const hasOdds =
    odds.home.moneyline != null ||
    odds.away.moneyline != null ||
    odds.home.spread != null ||
    odds.away.spread != null ||
    odds.overUnder != null;

  const isClose =
    homeProb != null && awayProb != null ? Math.abs(homeProb - awayProb) < 10 : false;
  const isFavorite =
    homeProb != null && awayProb != null
      ? homeProb > awayProb
        ? 'home'
        : 'away'
      : null;

  const homePace = apiGame.homeTeam.pace;
  const awayPace = apiGame.awayTeam.pace;
  const paceSignal =
    homePace != null && awayPace != null
      ? {
          label:
            (homePace + awayPace) / 2 >= 102
              ? 'FAST'
              : (homePace + awayPace) / 2 <= 98
                ? 'SLOW'
                : 'AVG',
          projected: (homePace + awayPace) / 2,
        }
      : undefined;

  const homeDef = apiGame.homeTeam.defensiveRating;
  const awayDef = apiGame.awayTeam.defensiveRating;
  let weakness: Game['weakness'] | undefined;
  if (homeDef != null && awayDef != null) {
    const worseTeam = homeDef > awayDef ? apiGame.homeTeam : apiGame.awayTeam;
    const worseRank =
      homeDef > awayDef ? apiGame.homeTeam.defensiveRank : apiGame.awayTeam.defensiveRank;
    if (worseRank != null && worseRank > 0) {
      weakness = {
        label: 'Def Rtg',
        team: worseTeam.abbreviation,
        rank: worseRank,
      };
    }
  }

  // Tipoff in ET — slate dates are ET; do not use server/browser local TZ for schedule times.
  return {
    id: apiGame.id,
    gameDate: apiGame.gameDate,
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
    startTime: formatTipoffEt(apiGame.startTime),
    homeOdds: {
      moneyline: odds.home.moneyline,
      spread: odds.home.spread,
      spreadOdds: odds.home.spreadOdds,
    },
    awayOdds: {
      moneyline: odds.away.moneyline,
      spread: odds.away.spread,
      spreadOdds: odds.away.spreadOdds,
    },
    overUnder: odds.overUnder,
    overOdds: odds.overOdds,
    underOdds: odds.underOdds,
    homeImpliedProb: homeProb != null ? Math.round(homeProb) : null,
    awayImpliedProb: awayProb != null ? Math.round(awayProb) : null,
    isFavorite,
    isClose,
    paceSignal,
    weakness,
    status: apiGame.status || undefined,
    homeScore: apiGame.homeScore ?? undefined,
    awayScore: apiGame.awayScore ?? undefined,
    hasOdds,
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
  const [unauthorized, setUnauthorized] = useState(false);

  // Fetch games for a given date
  const fetchGames = useCallback(async (date: string) => {
    setLoadingGames(true);
    setError(null);
    setUnauthorized(false);
    try {
      const res = await fetch(`/api/betting/games?date=${encodeURIComponent(date)}`);
      if (res.status === 401) {
        setUnauthorized(true);
        setGames([]);
        return;
      }
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
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
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
        return Math.abs(a.homeOdds.spread ?? 0) - Math.abs(b.homeOdds.spread ?? 0);
      case 'total':
        return (b.overUnder ?? 0) - (a.overUnder ?? 0);
      case 'probability':
        return (
          Math.max(b.homeImpliedProb ?? 0, b.awayImpliedProb ?? 0) -
          Math.max(a.homeImpliedProb ?? 0, a.awayImpliedProb ?? 0)
        );
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
            <div className="glass-card rounded-xl p-4 border border-white/10">
              <p className="text-sm text-muted-foreground">
                Offseason mode is active. Live props and automated slate refreshes are currently paused while we
                improve next season tooling.
              </p>
            </div>
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

            {/* Auth / Error State */}
            {unauthorized && (
              <UnauthorizedPanel onRetry={() => fetchGames(selectedDate)} />
            )}
            {error && !unauthorized && (
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
