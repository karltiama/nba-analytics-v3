'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GameCard,
  AIInsightPanel,
  BettingInsights,
  FilterBar,
  getTodayET,
  getDateLabel,
  TrendingPlayerStrip,
  UnauthorizedPanel,
  type Insight,
  type SortOption,
} from '@/components/betting';
import { GettingStartedChecklist } from '@/components/onboarding/GettingStartedChecklist';
import { ExistingUserPrompt } from '@/components/onboarding/ProductTourDialog';
import {
  GameCardSkeleton,
  BettingInsightsSkeleton,
  AIInsightPanelSkeleton,
} from '@/components/betting/skeletons';
import { filterSlateGames } from '@/lib/betting/slate-filters';
import {
  interpretScoreboardPayload,
  SCOREBOARD_CLIENT_REFRESH_MS,
  scoreboardApiUrl,
  scoreboardPollDelayMs,
} from '@/lib/scoreboard/client';
import type { ScoreboardResponse } from '@/lib/scoreboard/contract';
import {
  mergeTodaysGames,
  todaysGamesUnavailableCopy,
  type ScoreboardSlateAvailability,
} from '@/lib/scoreboard/slate-merge';

// ================================
// DATA FETCHING
// ================================

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
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>([]);

  // Selected date from URL (ET, YYYY-MM-DD); default today
  const selectedDate = useMemo(() => {
    const date = searchParams.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return getTodayET();
  }, [searchParams]);

  // Data states
  const [scoreboard, setScoreboard] = useState<ScoreboardResponse | null>(null);
  const [scoreboardDate, setScoreboardDate] = useState(selectedDate);
  const [scoreboardAvailability, setScoreboardAvailability] = useState<ScoreboardSlateAvailability>('loading');
  const [insights, setInsights] = useState<Insight[]>([]);
  const [widgets, setWidgets] = useState<any[]>([]);
  const [slateSummary, setSlateSummary] = useState<string | null>(null);
  const [slateSummaryHint, setSlateSummaryHint] = useState<string | null>(null);
  const [slateEntitlementRequired, setSlateEntitlementRequired] = useState(false);
  const [slateBriefingEligible, setSlateBriefingEligible] = useState(false);

  // Loading states
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [slateSummaryLoading, setSlateSummaryLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  if (scoreboardDate !== selectedDate) {
    setScoreboardDate(selectedDate);
    setScoreboard(null);
    setScoreboardAvailability('loading');
  }

  // Update URL when date changes (shareable link)
  const handleDateChange = useCallback(
    (date: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', date);
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Optional: sync URL to today when no date param (so default view is shareable)
  useEffect(() => {
    if (!searchParams.get('date')) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', getTodayET());
      router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    }
  }, []); // run once on mount

  const loadScoreboard = useCallback(async (date: string, signal: AbortSignal) => {
    try {
      const res = await fetch(scoreboardApiUrl(date), { signal });
      const body: unknown = await res.json().catch(() => null);
      if (signal.aborted) return;
      const outcome = interpretScoreboardPayload(res.status, body);
      if (outcome.status === 'ready') {
        setScoreboard(outcome.response);
        setScoreboardAvailability('ready');
        return;
      }
      if (outcome.status === 'disabled') {
        setScoreboard(null);
        setScoreboardAvailability('disabled');
        return;
      }
      setScoreboardAvailability('error');
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      setScoreboardAvailability('error');
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void loadScoreboard(selectedDate, ac.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [selectedDate, loadScoreboard]);

  const scoreboardPollDelay = scoreboardPollDelayMs(scoreboard?.games);
  useEffect(() => {
    if (scoreboardPollDelay == null) return;
    const ac = new AbortController();
    let timer = 0;
    const tick = () => {
      if (document.visibilityState !== 'hidden') void loadScoreboard(selectedDate, ac.signal);
      timer = window.setTimeout(tick, SCOREBOARD_CLIENT_REFRESH_MS);
    };
    timer = window.setTimeout(tick, scoreboardPollDelay);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [scoreboardPollDelay, selectedDate, loadScoreboard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/settings', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { settings?: { favoriteTeams?: string[] } };
        if (!cancelled && Array.isArray(data.settings?.favoriteTeams)) {
          setFavoriteTeams(data.settings.favoriteTeams);
        }
      } catch {
        /* unauthenticated / no settings — Favorites filter stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setSlateEntitlementRequired(false);

    (async () => {
      try {
        const res = await fetch(
          `/api/betting/ai-slate-insights?date=${encodeURIComponent(selectedDate)}`,
          { signal: ac.signal }
        );
        const data = await res.json();
        if (data.error === 'ENTITLEMENT_REQUIRED' || res.status === 403) {
          setSlateSummary(null);
          setSlateBriefingEligible(false);
          setSlateEntitlementRequired(true);
          setSlateSummaryHint(null);
        } else if (data.eligible === false || data.code === 'OFFSEASON' || data.code === 'NO_SLATE') {
          setSlateSummary(null);
          setSlateBriefingEligible(false);
          setSlateEntitlementRequired(false);
          setSlateSummaryHint(
            typeof data.message === 'string' ? data.message : 'Briefing unavailable during offseason'
          );
        } else if (data.summary && typeof data.summary === 'string') {
          setSlateSummary(data.summary);
          setSlateBriefingEligible(true);
          setSlateSummaryHint(null);
        } else {
          setSlateSummary(null);
          setSlateBriefingEligible(false);
          setSlateSummaryHint(
            typeof data.message === 'string'
              ? data.message
              : data.code === 'NO_OPENAI_KEY'
                ? 'Slate briefing is unavailable right now.'
                : data.code === 'OPENAI_ERROR'
                  ? 'Could not load the slate briefing. Try again later.'
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

  const slateGames = useMemo(() => mergeTodaysGames(scoreboard), [scoreboard]);

  // Filter games
  const filteredGames = filterSlateGames({
    games: slateGames,
    searchValue,
    showCloseMatchups,
    isClose: (game) => game.isClose,
    showFavoritesOnly,
    favoriteTeams,
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
            {/* Date + Filters (single bar) */}
            <ExistingUserPrompt />
            <GettingStartedChecklist />
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

            {unauthorized && (
              <UnauthorizedPanel onRetry={() => fetchInsights()} />
            )}

            {/* Trending Players Strip */}
            <TrendingPlayerStrip />

            {/* Games for selected date */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="type-section-heading text-[#063f46]">{gamesSectionTitle}</h2>
                <span className="type-metadata">
                  {scoreboardAvailability === 'loading' ? 'Loading...' : `${sortedGames.length} games`}
                </span>
              </div>

              {scoreboardAvailability === 'error' && sortedGames.length > 0 ? (
                <p className="type-secondary mb-3 text-amber-700" data-scoreboard-refresh="failed">
                  Showing the last scoreboard update. A refresh failed.
                </p>
              ) : null}
              
              {scoreboardAvailability === 'loading' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <GameCardSkeleton key={i} />
                  ))}
                </div>
              ) : sortedGames.length === 0 ? (
                <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center">
                  <p className="type-section-heading text-[#063f46]" data-slate-empty>
                    {scoreboardAvailability === 'ready'
                      ? emptyGamesMessage
                      : todaysGamesUnavailableCopy(scoreboardAvailability === 'disabled' ? 'disabled' : 'error')}
                  </p>
                  {scoreboardAvailability === 'ready' ? (
                  <p className="type-body mt-2 text-cc-secondary">
                    You can still research historical props or open a parlay workspace.
                  </p>
                  ) : null}
                  {scoreboardAvailability === 'ready' ? (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Link
                      href="/betting/props-explorer"
                      className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
                    >
                      Explore Props
                    </Link>
                    <Link
                      href="/parlay-workspace"
                      className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#DCE9EA] px-4 text-[#063f46] hover:bg-[#f7f9f7]"
                    >
                      Open Workspace
                    </Link>
                  </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedGames.map((game, index) => (
                    <div key={game.id} className="slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                      <GameCard game={game} researchDate={selectedDate} presentation="scoreboard" />
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
                slateEntitlementRequired={slateEntitlementRequired}
                briefingEligible={slateBriefingEligible}
              />
            </div>
          </aside>
        </div>
    </main>
  );
}
