'use client';

import { use, useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  type Game,
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
  createScoreboardRetrySession,
  scoreboardRetryDelayMs,
  todaysGamesCountLabel,
  todaysGamesEmptyView,
  type ScoreboardCoverage,
  type ScoreboardRetryOutcome,
} from '@/lib/scoreboard/empty-state';
import {
  mergeTodaysGames,
  type ScoreboardSlateAvailability,
} from '@/lib/scoreboard/slate-merge';
import {
  OPENING_NIGHT_DATE_LABEL,
  OPENING_NIGHT_EMPTY_COPY,
  OPENING_NIGHT_ERROR_COPY,
  OPENING_NIGHT_HEADING,
  OPENING_NIGHT_SECTION_NOTICE,
  decideOpeningNightPreview,
  isRenderableOpeningNightCard,
} from '@/lib/dashboard/opening-night-preview';
import { acceptsStoredOdds, applyStoredOdds, type StoredOddsPatch } from '@/lib/dashboard/stored-odds';
import {
  createStoredOddsRefreshSession,
  STORED_ODDS_MIN_REFRESH_MS,
} from '@/lib/dashboard/stored-odds-refresh';

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
  const [scoreboardCoverage, setScoreboardCoverage] = useState<ScoreboardCoverage | null>(null);
  const [scoreboardDate, setScoreboardDate] = useState(selectedDate);
  const [scoreboardAvailability, setScoreboardAvailability] = useState<ScoreboardSlateAvailability>('loading');
  const retryStartRef = useRef({
    outcome: 'ready_empty' as ScoreboardRetryOutcome,
    todayEt: '',
    coverageState: null as ScoreboardCoverage['state'] | null,
  });
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
  const [todayEt, setTodayEt] = useState(() => getTodayET());
  const [previewGames, setPreviewGames] = useState<Game[] | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [storedOdds, setStoredOdds] = useState<Record<string, StoredOddsPatch>>({});

  if (scoreboardDate !== selectedDate) {
    setScoreboardDate(selectedDate);
    setScoreboard(null);
    setScoreboardCoverage(null);
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

  const loadScoreboard = useCallback(async (date: string, signal: AbortSignal): Promise<ScoreboardRetryOutcome | undefined> => {
    try {
      const res = await fetch(scoreboardApiUrl(date), { signal });
      const body: unknown = await res.json().catch(() => null);
      if (signal.aborted) return;
      const outcome = interpretScoreboardPayload(res.status, body);
      if (outcome.status === 'ready') {
        setScoreboard(outcome.response);
        setScoreboardCoverage(outcome.coverage);
        setScoreboardAvailability('ready');
        return outcome.response.games.length > 0 ? 'ready_with_games' : 'ready_empty';
      }
      if (outcome.status === 'disabled') {
        setScoreboard(null);
        setScoreboardCoverage(null);
        setScoreboardAvailability('disabled');
        return 'disabled';
      }
      setScoreboardAvailability('error');
      return 'error';
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      setScoreboardAvailability('error');
      return 'error';
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

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTodayEt(getTodayET());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const slateGames = useMemo(() => mergeTodaysGames(scoreboard), [scoreboard]);
  const previewGate = decideOpeningNightPreview({
    todayEt,
    selectedDate,
    availability: scoreboardAvailability,
    presentableScoreboardGames: slateGames.length,
  });

  useEffect(() => {
    if (previewGate.kind !== 'preview') {
      setPreviewGames(null);
      setPreviewState('idle');
      return;
    }
    const ac = new AbortController();
    setPreviewState('loading');
    (async () => {
      try {
        const res = await fetch('/api/dashboard/opening-night-preview', { signal: ac.signal });
        const body: unknown = await res.json().catch(() => null);
        if (ac.signal.aborted) return;
        const games = body && typeof body === 'object' && Array.isArray((body as { games?: unknown }).games)
          ? ((body as { games: Game[] }).games.filter(isRenderableOpeningNightCard))
          : null;
        if (!res.ok || games == null) {
          setPreviewGames(null);
          setPreviewState('error');
          return;
        }
        setPreviewGames(games);
        setPreviewState(games.length === 0 ? 'empty' : 'ready');
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setPreviewGames(null);
        setPreviewState('error');
      }
    })();
    return () => ac.abort();
  }, [previewGate.kind, selectedDate, todayEt]);

  const previewActive = previewGate.kind === 'preview';
  const previewPending = previewActive && (previewState === 'idle' || previewState === 'loading');
  retryStartRef.current = {
    outcome:
      scoreboardAvailability === 'disabled'
        ? 'disabled'
        : scoreboardAvailability === 'error'
          ? 'error'
          : slateGames.length > 0
            ? 'ready_with_games'
            : 'ready_empty',
    todayEt,
    coverageState: scoreboardCoverage?.state ?? null,
  };
  const scoreboardRetryNeeded =
    scoreboardAvailability !== 'loading' &&
    scoreboardPollDelay == null &&
    scoreboardRetryDelayMs({
      availability:
        scoreboardAvailability === 'disabled' ? 'disabled' : scoreboardAvailability === 'error' ? 'error' : 'ready',
      unfilteredCount: slateGames.length,
      coverageState: scoreboardCoverage?.state ?? null,
      selectedDate,
      todayEt,
      consecutiveFailures: 1,
    }) != null;

  useEffect(() => {
    if (!scoreboardRetryNeeded) return;
    let timer = 0;
    const session = createScoreboardRetrySession({
      load: async (signal) => {
        const outcome = await loadScoreboard(selectedDate, signal);
        if (signal.aborted || outcome == null) return 'error';
        return outcome;
      },
      delayFor: (outcome, consecutiveFailures) =>
        scoreboardRetryDelayMs({
          availability: outcome === 'disabled' ? 'disabled' : outcome === 'error' ? 'error' : 'ready',
          unfilteredCount: outcome === 'ready_with_games' ? 1 : 0,
          coverageState: retryStartRef.current.coverageState,
          selectedDate,
          todayEt: retryStartRef.current.todayEt,
          consecutiveFailures,
        }),
      isVisible: () => document.visibilityState !== 'hidden',
      armTimer: (ms, fire) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(fire, ms);
      },
      clearTimer: () => window.clearTimeout(timer),
    });
    session.start(retryStartRef.current.outcome);
    return () => session.stop();
  }, [scoreboardRetryNeeded, selectedDate, loadScoreboard]);

  const slateIds = useMemo(() => slateGames.map((game) => game.id).sort().join(','), [slateGames]);
  const applicablePregameIds = useMemo(
    () => slateGames.filter((game) => acceptsStoredOdds(game)).map((game) => game.id).sort().join(','),
    [slateGames]
  );

  useEffect(() => {
    if (previewActive || applicablePregameIds.length === 0) {
      setStoredOdds({});
      return;
    }
    const requestKey = `${selectedDate}|${slateIds}|${applicablePregameIds}`;
    let closed = false;
    let timer = 0;
    setStoredOdds({});
    const session = createStoredOddsRefreshSession({
      requestKey,
      isClosed: () => closed,
      nowMs: () => Date.now(),
      isVisible: () => document.visibilityState !== 'hidden',
      fetchOdds: async (signal) => {
        const res = await fetch(`/api/dashboard/stored-odds?date=${encodeURIComponent(selectedDate)}`, {
          signal,
          cache: 'no-store',
        });
        const body: unknown = await res.json().catch(() => null);
        return { ok: res.ok, body };
      },
      setOverlay: setStoredOdds,
      armTimer: (delayMs, onFire) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(onFire, Math.max(delayMs, STORED_ODDS_MIN_REFRESH_MS));
      },
      clearTimer: () => window.clearTimeout(timer),
    });
    session.start();
    const onVisibility = () => session.onVisible();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      session.stop();
    };
  }, [previewActive, selectedDate, slateIds, applicablePregameIds]);

  const previewList = previewActive && previewState === 'ready' ? previewGames ?? [] : slateGames;
  const listGames = previewList.map((game) => applyStoredOdds(game, storedOdds[game.id]));

  // Filter games
  const filteredGames = filterSlateGames({
    games: listGames,
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
  const gamesSectionTitle = previewActive
    ? OPENING_NIGHT_HEADING
    : dateLabel === 'Today'
      ? "Today's Games"
      : dateLabel === 'Yesterday'
        ? "Yesterday's Games"
        : `Games for ${dateLabel}`;

  const emptyView =
    scoreboardAvailability === 'loading' || previewActive
      ? null
      : todaysGamesEmptyView({
          availability:
            scoreboardAvailability === 'disabled' ? 'disabled' : scoreboardAvailability === 'error' ? 'error' : 'ready',
          unfilteredCount: slateGames.length,
          filteredCount: sortedGames.length,
          coverage: scoreboardCoverage,
          selectedDate,
          todayEt,
          dateLabel,
        });

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
                <div>
                  <h2 className="type-section-heading text-[#063f46]">{gamesSectionTitle}</h2>
                  {previewActive ? (
                    <p className="type-body text-cc-secondary mt-1" data-opening-night-date>
                      {OPENING_NIGHT_DATE_LABEL}
                    </p>
                  ) : null}
                </div>
                <span className="type-metadata">
                  {scoreboardAvailability === 'loading' || previewPending
                    ? 'Loading...'
                    : previewActive && previewState === 'error'
                      ? 'Unavailable'
                      : previewActive
                        ? `${sortedGames.length} games`
                        : todaysGamesCountLabel({
                            shown: sortedGames.length,
                            total: slateGames.length,
                            view: emptyView,
                          })}
                </span>
              </div>
              {previewActive && !previewPending && previewState !== 'error' ? (
                <p className="type-secondary mb-3 text-cc-secondary" data-opening-night-notice>
                  {OPENING_NIGHT_SECTION_NOTICE}
                </p>
              ) : null}

              {scoreboardAvailability === 'error' && sortedGames.length > 0 ? (
                <p className="type-secondary mb-3 text-amber-700" data-scoreboard-refresh="failed">
                  Showing the last scoreboard update. A refresh failed.
                </p>
              ) : null}
              
              {scoreboardAvailability === 'loading' || previewPending ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <GameCardSkeleton key={i} />
                  ))}
                </div>
              ) : previewActive && previewState === 'error' ? (
                <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center">
                  <p className="type-section-heading text-[#063f46]" data-opening-night-error>
                    {OPENING_NIGHT_ERROR_COPY}
                  </p>
                </div>
              ) : previewActive && previewState === 'empty' ? (
                <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center">
                  <p className="type-section-heading text-[#063f46]" data-opening-night-empty>
                    {OPENING_NIGHT_EMPTY_COPY}
                  </p>
                </div>
              ) : sortedGames.length === 0 ? (
                <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center">
                  <p className="type-section-heading text-[#063f46]" data-slate-empty>
                    {emptyView?.message}
                  </p>
                  {emptyView?.showResearchLinks ? (
                  <p className="type-body mt-2 text-cc-secondary">
                    You can still research historical props or open a parlay workspace.
                  </p>
                  ) : null}
                  {emptyView?.showResearchLinks ? (
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
                  {emptyView?.showClearFilters ? (
                  <button
                    type="button"
                    className="type-interactive mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
                    onClick={() => {
                      setSearchValue('');
                      setShowFavoritesOnly(false);
                      setShowCloseMatchups(false);
                    }}
                  >
                    Clear filters
                  </button>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedGames.map((game, index) => (
                    <div key={game.id} className="slide-up h-full" style={{ animationDelay: `${index * 50}ms` }}>
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
