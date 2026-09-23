'use client';

import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search, CalendarDays, ListFilter, ExternalLink } from 'lucide-react';
import { getTodayET, addDaysET, getDateLabel } from '@/components/betting';
import { formatProjectionGap, projectionGap } from '@/lib/betting/market-probability';
import {
  PropsExplorerPlayerPanel,
  PropsExplorerPlayerSidebarPlaceholder,
  type PropsExplorerSelection,
} from '@/components/betting/PropsExplorerPlayerPanel';
import {
  PropsExplorerMarketPanel,
  type PropsExplorerMarketSelection,
} from '@/components/betting/PropsExplorerMarketPanel';
import { PropsExplorerGameContextPanel } from '@/components/betting/PropsExplorerGameContextPanel';
import { PropsExplorerParlayTray } from '@/components/betting/PropsExplorerParlayTray';
import { PropsExplorerMobileControls } from '@/components/betting/PropsExplorerMobileControls';
import { PropsExplorerPropCard } from '@/components/betting/PropsExplorerPropCard';
import { PropsExplorerTableSkeleton } from '@/components/betting/PropsExplorerTableSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { propsExplorerEmptyCopy } from '@/lib/betting/props-explorer-empty';
import {
  EXPLORER_BOOKS,
  EXPLORER_SORT_OPTIONS,
  playerSearchUpdates,
  PLAYER_SEARCH_COMMIT_MS,
} from '@/lib/betting/props-explorer-filters';
import {
  explorerTableValueCopy,
  explorerValueToneClass,
  formatExplorerOdds,
} from '@/lib/betting/props-explorer-row-display';
import {
  explorerGamesApiHref,
  gameDetailHref,
  playerResearchHref,
} from '@/lib/betting/research-journey';
import { savedResearchHref } from '@/lib/betting/saved-research';
import type { PropsExplorerOfferInput } from '@/lib/parlay/adapt-props-explorer-offer';
import {
  addResultNotice,
  isOfferSelected,
} from '@/lib/parlay/selection';
import { useParlaySelection } from '@/lib/parlay/use-parlay-selection';
import { completeChecklistItem } from '@/lib/onboarding/progress';
import {
  PLAYER_SEARCH_RESULT_OPENED,
  PLAYER_SEARCH_USED,
  playerSearchResultOpenedProperties,
  playerSearchUsedProperties,
} from '@/lib/product-analytics/discovery-events';
import {
  PROP_ADDED_TO_PARLAY,
  PROP_CONTEXT_OPENED,
  PROP_OPENED,
  propAddedToParlayProperties,
  propContextOpenedProperties,
  propOpenedProperties,
} from '@/lib/product-analytics/props-explorer-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

type ExplorerRow = {
  gameId: number;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  snapshotAt: string;
  modelProbability: number | null;
  ev: number | null;
  projection: number | null;
  evSelectedTrack: string;
  calibrationVersion: string | null;
  confidenceTier?: 'high' | 'medium' | 'low' | null;
  anchorDeltaAbsTrackB?: number | null;
  marketContext?: 'live' | 'historical';
  lineLabel?: string;
  paperBetAllowed?: boolean;
  sourceTable?: string;
};

type ExplorerMeta = {
  totalMatching: number;
  evSelectedTrack: string;
  calibrationVersion: string | null;
  computedAt: string;
  evFetchCap: number | null;
  sort: string;
  dir: string;
  ingestionFrozen?: boolean;
  marketContext?: 'live' | 'historical';
  sourceTable?: string;
  lineLabel?: string;
  dateEt?: string;
};

type SavedProp = {
  id: string;
  gameId: string;
  playerId: number;
  sportsbook: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  snapshotAt: string | null;
};

type PageProps = {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function formatConfidenceSimple(confidence: ExplorerRow['confidenceTier']): string {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';
  if (confidence === 'low') return 'Low';
  return '—';
}

function formatOdds(odds: number | null): string {
  return formatExplorerOdds(odds);
}

function formatPlayerLabel(playerName: string | null, playerId: number): string {
  const raw = (playerName ?? '').trim();
  if (!raw) return String(playerId);
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return raw;
  const first = parts[0] ?? '';
  const last = parts.slice(1).join(' ');
  if (!first) return raw;
  return `${first[0]}. ${last}`;
}

function rowToParlayOfferInput(r: ExplorerRow): PropsExplorerOfferInput {
  return {
    playerId: r.playerId,
    playerName: r.playerName,
    gameId: r.gameId,
    propType: r.propType,
    side: r.side,
    lineValue: r.lineValue,
    sportsbook: r.sportsbook,
    oddsAmerican: r.oddsAmerican,
    snapshotAt: r.snapshotAt,
    marketContext: r.marketContext,
    sourceTable: r.sourceTable,
  };
}

export default function PropsExplorerPage(props: PageProps) {
  if (props.params) use(props.params);
  if (props.searchParams) use(props.searchParams);

  const searchParams = useSearchParams();
  const router = useRouter();

  const date = useMemo(() => {
    const d = searchParams.get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return getTodayET();
  }, [searchParams]);

  const gameId = searchParams.get('game_id') ?? '';
  const playerName = searchParams.get('player_name') ?? '';
  const propType = searchParams.get('prop_type') ?? '';
  const side = searchParams.get('side') ?? 'all';
  const sportsbook = searchParams.get('sportsbook') ?? '';
  const selectedBooks = useMemo(() => new Set(sportsbook.split(',').filter(Boolean)), [sportsbook]);
  const sort = searchParams.get('sort') ?? 'snapshot_at';
  const dir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  const minEv = searchParams.get('min_ev') ?? '';
  const limit = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get('limit') || '100', 10) || 100)
  );
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [meta, setMeta] = useState<ExplorerMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<Array<{ id: string; label: string }>>([]);
  const [addingPaperKey, setAddingPaperKey] = useState<string | null>(null);
  const [savedPropIdByKey, setSavedPropIdByKey] = useState<Record<string, string>>({});
  const [savingPropKey, setSavingPropKey] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PropsExplorerSelection | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<PropsExplorerMarketSelection | null>(null);
  const [isXlViewport, setIsXlViewport] = useState(false);
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);
  const [parlayNotice, setParlayNotice] = useState<string | null>(null);
  const lastPlayerSearchTracked = useRef<string | null>(null);
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;
  const {
    legs: selectedParlayLegs,
    addExplorerOffer,
    removeLeg: removeParlayLeg,
    clear: clearParlaySelection,
    rememberExplorerReturnHref,
  } = useParlaySelection();

  useEffect(() => {
    completeChecklistItem('explore_prop');
  }, []);

  const marketContext: 'live' | 'historical' =
    meta?.marketContext ?? (date < getTodayET() ? 'historical' : 'live');
  const lineLabel =
    meta?.lineLabel ??
    (marketContext === 'historical' ? 'Historical closing line' : 'Current market');

  const effectiveGameId = useMemo(() => {
    const fromFilter = gameId.trim();
    if (fromFilter) return fromFilter;
    if (selectedPlayer?.gameId != null) return String(selectedPlayer.gameId);
    if (selectedMarket?.gameId != null) return String(selectedMarket.gameId);
    return null;
  }, [gameId, selectedPlayer, selectedMarket]);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const sync = () => setIsXlViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    setSelectedMarket(null);
  }, [date, gameId]);

  useEffect(() => {
    const qs = searchParams.toString();
    rememberExplorerReturnHref(qs ? `/betting/props-explorer?${qs}` : '/betting/props-explorer');
  }, [rememberExplorerReturnHref, searchParams]);

  const buildSavedPropKey = useCallback((v: SavedProp | ExplorerRow) => {
    return [
      String(v.gameId),
      String(v.playerId),
      v.sportsbook ?? '',
      v.propType ?? '',
      v.side ?? '',
      v.lineValue ?? '',
      v.snapshotAt ?? '',
    ].join('|');
  }, []);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/betting/props-explorer?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const updateParamsRef = useRef(updateParams);
  updateParamsRef.current = updateParams;
  const [searchDraft, setSearchDraft] = useState(playerName);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    if (searchTimer.current !== null) return;
    setSearchDraft(playerName);
  }, [playerName]);

  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, []);

  const schedulePlayerSearch = useCallback((value: string) => {
    setSearchDraft(value);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      searchTimer.current = null;
      updateParamsRef.current(playerSearchUpdates(value));
    }, PLAYER_SEARCH_COMMIT_MS);
  }, []);

  const clearPlayerSearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setSearchDraft('');
    updateParamsRef.current(playerSearchUpdates(''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          explorerGamesApiHref({ dateEt: date, todayEt: getTodayET() })
        );
        if (!res.ok) return;
        const data = await res.json();
        const list = (data.games || []).map(
          (g: {
            id: string;
            homeTeam: { abbreviation: string };
            awayTeam: { abbreviation: string };
          }) => ({
            id: g.id,
            label: `${g.awayTeam.abbreviation} @ ${g.homeTeam.abbreviation}`,
          })
        );
        if (!cancelled) setGames(list);
      } catch {
        if (!cancelled) setGames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/saved-props?limit=200');
        if (res.status === 401) {
          if (!cancelled) setSavedPropIdByKey({});
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const next: Record<string, string> = {};
        for (const row of data.rows ?? []) {
          const key = buildSavedPropKey(row as SavedProp);
          next[key] = String(row.id);
        }
        if (!cancelled) setSavedPropIdByKey(next);
      } catch {
        if (!cancelled) setSavedPropIdByKey({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildSavedPropKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const u = new URL('/api/betting/props-explorer', window.location.origin);
        u.searchParams.set('limit', String(limit));
        u.searchParams.set('offset', String(offset));
        u.searchParams.set('sort', sort);
        u.searchParams.set('dir', dir);
        if (gameId.trim()) u.searchParams.set('game_id', gameId.trim());
        else u.searchParams.set('date', date);
        if (playerName.trim()) u.searchParams.set('player_name', playerName.trim());
        if (propType.trim()) u.searchParams.set('prop_type', propType.trim());
        if (side && side !== 'all') u.searchParams.set('side', side);
        if (sportsbook.trim()) u.searchParams.set('sportsbook', sportsbook.trim());
        if (
          date >= getTodayET() &&
          minEv.trim() !== '' &&
          !Number.isNaN(parseFloat(minEv))
        ) {
          u.searchParams.set('min_ev', minEv.trim());
        }
        const res = await fetch(u.toString());
        if (!res.ok) throw new Error('Failed to load props');
        const data = await res.json();
        if (!cancelled) {
          const frozen = Boolean(data.meta?.ingestionFrozen);
          const hasExplicitDate = Boolean(searchParams.get('date'));
          const noFiltersApplied =
            !gameId.trim() &&
            !playerName.trim() &&
            !propType.trim() &&
            side === 'all' &&
            !sportsbook.trim() &&
            minEv.trim() === '';
          // Live mode only: if default "today" has no props yet, fall back once to yesterday.
          if (
            !frozen &&
            Array.isArray(data.rows) &&
            data.rows.length === 0 &&
            !hasExplicitDate &&
            noFiltersApplied
          ) {
            updateParams({ date: addDaysET(date, -1), offset: '0' });
            return;
          }
          const nextRows = data.rows ?? [];
          setRows(nextRows);
          setMeta(data.meta ?? null);
          const searchedName = playerName.trim();
          if (searchedName.length < 2) {
            lastPlayerSearchTracked.current = null;
          } else {
            const resultCount = nextRows.length;
            window.setTimeout(() => {
              if (playerNameRef.current.trim() !== searchedName) return;
              if (lastPlayerSearchTracked.current === searchedName) return;
              lastPlayerSearchTracked.current = searchedName;
              trackEvent(
                PLAYER_SEARCH_USED,
                playerSearchUsedProperties('props_explorer', resultCount)
              );
            }, 500);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setMeta(null);
          setError(e instanceof Error ? e.message : 'Error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, gameId, playerName, propType, side, sportsbook, sort, dir, minEv, limit, offset, searchParams, updateParams]);

  const selectClass =
    'rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] text-xs py-1.5 px-2 min-w-0 focus:outline-none focus:ring-1 focus:ring-[#55ddb1] focus:border-[#075B5C]';
  const inputClass =
    'rounded-lg border border-[#DCE9EA] bg-white text-[#063f46] text-xs py-1.5 px-2 w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-[#55ddb1] focus:border-[#075B5C]';

  const evSortActive = ['ev', 'ev_track_a', 'ev_track_b'].includes(sort);
  const canPrev = offset > 0;
  const canNext = rows.length === limit;

  const addToPaper = useCallback(
    async (r: ExplorerRow) => {
      if (r.paperBetAllowed === false || r.marketContext === 'historical') {
        setError('Paper bets cannot be placed on completed historical games');
        return;
      }
      const key = `${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}`;
      setAddingPaperKey(key);
      setError(null);
      try {
        const res = await fetch('/api/betting/paper-bets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId: r.gameId,
            playerId: r.playerId,
            playerName: r.playerName,
            sportsbook: r.sportsbook,
            propType: r.propType,
            marketType: r.marketType,
            side: r.side,
            lineValue: r.lineValue,
            oddsAmerican: r.oddsAmerican,
            impliedProbability: r.impliedProbability,
            ev: r.ev,
            confidenceTier: r.confidenceTier ?? null,
            calibrationVersion: r.calibrationVersion,
            decisionSnapshotAt: r.snapshotAt,
            modelProbability: r.modelProbability,
            projection: r.projection,
            evSelectedTrack: r.evSelectedTrack,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to add paper bet');
        router.push('/betting/paper?tab=open');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add to paper');
      } finally {
        setAddingPaperKey(null);
      }
    },
    [router]
  );

  const toggleSavedProp = useCallback(
    async (r: ExplorerRow) => {
      const key = buildSavedPropKey(r);
      setSavingPropKey(key);
      setError(null);
      setSaveNotice(null);
      try {
        const existingId = savedPropIdByKey[key];
        if (existingId) {
          const res = await fetch(`/api/user/saved-props?id=${encodeURIComponent(existingId)}`, {
            method: 'DELETE',
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || data.error || 'Failed to remove saved prop');
          setSavedPropIdByKey((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
          setSaveNotice('Removed from saved research');
          return;
        }

        const res = await fetch('/api/user/saved-props', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId: r.gameId,
            playerId: r.playerId,
            playerName: r.playerName,
            sportsbook: r.sportsbook,
            propType: r.propType,
            marketType: r.marketType,
            side: r.side,
            lineValue: r.lineValue,
            oddsAmerican: r.oddsAmerican,
            impliedProbability: r.impliedProbability,
            snapshotAt: r.snapshotAt,
            marketContext: r.marketContext,
            dateEt: date,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to save prop');
        const savedId = data?.savedProp?.id;
        if (savedId) {
          setSavedPropIdByKey((prev) => ({ ...prev, [key]: String(savedId) }));
        }
        setSaveNotice('Saved for research');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save prop');
      } finally {
        setSavingPropKey(null);
      }
    },
    [buildSavedPropKey, savedPropIdByKey, date]
  );

  const addToParlay = useCallback((r: ExplorerRow) => {
    const gameLabel = games.find((g) => g.id === String(r.gameId))?.label ?? null;
    const result = addExplorerOffer(rowToParlayOfferInput(r), { gameLabel });
    setParlayNotice(addResultNotice(result));
    completeChecklistItem('parlay_leg_added');
    if (result.status === 'added') {
      trackEvent(PROP_ADDED_TO_PARLAY, propAddedToParlayProperties(r.propType));
    }
  }, [addExplorerOffer, games]);

  const clearParlay = useCallback(() => {
    clearParlaySelection();
    setParlayNotice(null);
  }, [clearParlaySelection]);

  return (
    <main
      className={`max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 ${
        selectedParlayLegs.length > 0
          ? 'pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:pb-28'
          : 'pb-[calc(2.5rem+env(safe-area-inset-bottom))] lg:pb-12'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#063f46]">Props Explorer</h1>
          <p className="hidden lg:block text-xs text-[#4a6366] mt-1">
            {marketContext === 'historical'
              ? 'Last pre-tip closing lines for this date. Not a live sportsbook board. Estimated EV is not computed for historical dates.'
              : 'Simple mode grades Good/Fair/Bad from estimated EV (market-anchored). That is not the same as the projection gap.'}
          </p>
          <p className="mt-1.5 hidden lg:inline-flex items-center rounded-full border border-[#DCE9EA] bg-[#F8FBFA] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#063f46]">
            {lineLabel}
          </p>
        </div>
        {showAdvancedMetrics && meta ? (
          <p className="text-[10px] text-[#8aa0a3] font-mono">
            {meta.calibrationVersion} · {new Date(meta.computedAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <PropsExplorerMobileControls
        searchDraft={searchDraft}
        onSearchChange={schedulePlayerSearch}
        onSearchClear={clearPlayerSearch}
        date={date}
        gameId={gameId}
        games={games}
        propType={propType}
        side={side}
        minEv={minEv}
        sportsbook={sportsbook}
        sort={sort}
        dir={dir}
        marketContext={marketContext}
        lineLabel={lineLabel}
        showAdvancedMetrics={showAdvancedMetrics}
        onToggleAdvanced={() => setShowAdvancedMetrics((prev) => !prev)}
        onUpdate={updateParams}
      />

      <div className="hidden lg:block bg-white border border-[#DCE9EA] rounded-2xl shadow-sm w-full mb-6 overflow-hidden">
        {/* Context Row */}
        <div className="bg-[#F8FBFA] p-3 sm:px-4 border-b border-[#DCE9EA] flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1 shrink-0 bg-white p-1 rounded-lg border border-[#DCE9EA]">
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, -1), offset: '0' })}
              className="p-1.5 rounded-md hover:bg-[#f7f9f7] text-[#4a6366] hover:text-[#063f46] transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-2">
              <CalendarDays className="w-3.5 h-3.5 text-[#4a6366]" />
              <span className="text-sm font-medium text-[#063f46] min-w-[80px] text-center">
                {getDateLabel(date)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, 1), offset: '0' })}
              className="p-1.5 rounded-md hover:bg-[#f7f9f7] text-[#4a6366] hover:text-[#063f46] transition-colors"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-[#DCE9EA] mx-1" />
            <button
              type="button"
              onClick={() => updateParams({ date: getTodayET(), offset: '0' })}
              className="px-2 py-1 text-xs font-medium text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46] transition-colors rounded"
            >
              Today
            </button>
          </div>

          <select
            className={`${selectClass} min-w-[200px]`}
            aria-label="Game"
            value={gameId}
            onChange={(e) => updateParams({ game_id: e.target.value || null, offset: '0' })}
          >
            <option value="">All games ({date})</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
            {gameId.trim() && !games.some((g) => g.id === gameId.trim()) ? (
              <option value={gameId.trim()}>Selected game</option>
            ) : null}
          </select>
        </div>

        {/* Main Filters Grid */}
        <div className="p-3 sm:p-4 space-y-4" data-coachmark="props-discover">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div className="relative col-span-2 md:col-span-1">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-[#8aa0a3]" />
              </div>
              <input
                className={`${inputClass} pl-8`}
                placeholder="Player Name"
                value={searchDraft}
                onChange={(e) => schedulePlayerSearch(e.target.value)}
                aria-label="Player Name"
              />
            </div>

            <select
              className={selectClass}
              value={propType}
              onChange={(e) => updateParams({ prop_type: e.target.value || null, offset: '0' })}
              aria-label="Prop type"
            >
              <option value="">All props</option>
              <option value="points">Points</option>
              <option value="rebounds">Rebounds</option>
              <option value="assists">Assists</option>
              <option value="threes">Threes</option>
              <option value="points_assists">Pts + Ast</option>
              <option value="points_rebounds">Pts + Reb</option>
              <option value="rebounds_assists">Reb + Ast</option>
              <option value="points_rebounds_assists">PRA</option>
              <option value="steals">Steals</option>
              <option value="blocks">Blocks</option>
              <option value="turnovers">Turnovers</option>
            </select>

            <select
              className={selectClass}
              value={side}
              onChange={(e) => updateParams({ side: e.target.value === 'all' ? null : e.target.value, offset: '0' })}
              aria-label="Side"
            >
              <option value="all">All sides</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>

            <div className="relative col-span-1">
              <input
                className={`${inputClass} pl-8`}
                placeholder="0.0%"
                value={minEv}
                onChange={(e) => updateParams({ min_ev: e.target.value || null, offset: '0' })}
                aria-label="Minimum EV"
                disabled={marketContext === 'historical'}
                title={
                  marketContext === 'historical'
                    ? 'EV filters do not apply to historical closing lines'
                    : undefined
                }
              />
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <span className="text-[#8aa0a3] text-xs font-medium">EV+</span>
              </div>
            </div>

            <div className="col-span-2 md:col-span-4 lg:col-span-1 flex items-center gap-2">
              <select
                className={`${selectClass} flex-1`}
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value, offset: '0' })}
                aria-label="Sort by"
              >
                {EXPLORER_SORT_OPTIONS.filter((o) =>
                  marketContext === 'historical'
                    ? o.value === 'snapshot_at' || o.value === 'odds_american'
                    : true
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value === 'snapshot_at' && marketContext === 'historical'
                      ? 'Closing time'
                      : o.label}
                  </option>
                ))}
              </select>
              <select
                className={`${selectClass} w-20 shrink-0`}
                value={dir}
                onChange={(e) => updateParams({ dir: e.target.value, offset: '0' })}
                aria-label="Sort direction"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t border-[#DCE9EA]">
            <div className="flex items-center gap-1.5 text-[#4a6366] text-xs font-medium shrink-0">
              <ListFilter className="w-3.5 h-3.5" />
              <span>Sportsbooks:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Sportsbooks">
              {EXPLORER_BOOKS.map((book) => {
                const active = selectedBooks.has(book.id);
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(selectedBooks);
                      if (active) next.delete(book.id);
                      else next.add(book.id);
                      const val = Array.from(next).join(',');
                      updateParams({ sportsbook: val || null, offset: '0' });
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all duration-200 ${
                      active 
                        ? 'bg-[#55ddb1] border-[#55ddb1] text-[#063f46]' 
                        : 'bg-white border-[#DCE9EA] text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46]'
                    }`}
                  >
                    {book.label}
                  </button>
                );
              })}
            </div>
          </div>

          {evSortActive && meta?.evFetchCap != null && (
            <p className="text-[10px] text-amber-800 pt-1">
              EV sorts scan up to {meta.evFetchCap} freshest rows, then sort — global order is approximate
              for very large slates.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex-1 min-w-0">
      {error && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 border-l-4 border-l-red-500 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {saveNotice && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-3 border-l-4 border-l-[#20B95A] mb-4">
          <p className="text-sm text-[#075B5C]">
            {saveNotice}
            {saveNotice.startsWith('Saved') ? (
              <>
                {' '}
                <Link href={savedResearchHref()} className="underline hover:text-[#063f46]">
                  View saved
                </Link>
              </>
            ) : null}
          </p>
        </div>
      )}
      {parlayNotice && (
        <div
          className={`bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-3 mb-4 border-l-4 ${
            parlayNotice === 'Already added' ||
            parlayNotice.startsWith('Added') ||
            parlayNotice.includes('legs selected')
              ? 'border-l-[#20B95A]'
              : 'border-l-amber-500'
          }`}
          role="status"
        >
          <p className="text-sm text-[#075B5C]">{parlayNotice}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-[#4a6366]">
        <span className="flex items-center gap-2 min-h-[1.125rem]">
          {loading && rows.length === 0 ? (
            <>
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-36 sm:w-44" />
            </>
          ) : (
            <>
              {loading ? 'Refreshing…' : `${rows.length} rows`}
              {meta != null && ` · ${meta.totalMatching.toLocaleString()} matching`}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdvancedMetrics((prev) => !prev)}
            className="hidden lg:inline-flex px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[#DCE9EA] bg-white text-[#4a6366] hover:text-[#063f46] hover:bg-[#f7f9f7]"
            aria-pressed={showAdvancedMetrics}
          >
            {showAdvancedMetrics ? 'Hide advanced metrics' : 'Show advanced metrics'}
          </button>
          <button
            type="button"
            disabled={!canPrev || loading}
            onClick={() => updateParams({ offset: String(Math.max(0, offset - limit)) })}
            className="px-2 py-1 rounded-lg border border-[#DCE9EA] bg-white disabled:opacity-40 hover:bg-[#f7f9f7] text-[#063f46]"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!canNext || loading}
            onClick={() => updateParams({ offset: String(offset + limit) })}
            className="px-2 py-1 rounded-lg border border-[#DCE9EA] bg-white disabled:opacity-40 hover:bg-[#f7f9f7] text-[#063f46]"
          >
            Next
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <PropsExplorerTableSkeleton />
      ) : (
      <>
      <div className="lg:hidden min-w-0 space-y-3">
        {rows.length === 0 ? (
          <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm py-8 text-center">
            {(() => {
              const copy = propsExplorerEmptyCopy({
                frozen: Boolean(meta?.ingestionFrozen),
                dateLabel: getDateLabel(date),
                marketContext,
              });
              return (
                <div className="space-y-2 px-4">
                  <p className="type-body text-[#063f46]">{copy.title}</p>
                  <p className="type-metadata">{copy.detail}</p>
                  {gameId.trim() ? (
                    <p>
                      <Link href={gameDetailHref(gameId.trim())} className="type-interactive text-[#075B5C]">
                        Back to game
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            })()}
          </div>
        ) : (
          rows.map((r, idx) => {
            const paperKey = `${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}`;
            const saveKey = buildSavedPropKey(r);
            const isSaved = Boolean(savedPropIdByKey[saveKey]);
            const isOnParlay = isOfferSelected(selectedParlayLegs, rowToParlayOfferInput(r));
            return (
              <PropsExplorerPropCard
                key={`card-${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}-${idx}`}
                row={r}
                date={date}
                isSaved={isSaved}
                isSaving={savingPropKey === saveKey}
                saveBusy={savingPropKey !== null}
                isOnParlay={isOnParlay}
                isAddingPaper={addingPaperKey === paperKey}
                paperBusy={addingPaperKey !== null}
                showAdvanced={showAdvancedMetrics}
                onOpenContext={() => {
                  if (playerName.trim().length >= 2) {
                    trackEvent(
                      PLAYER_SEARCH_RESULT_OPENED,
                      playerSearchResultOpenedProperties('props_explorer')
                    );
                  }
                  trackEvent(PROP_CONTEXT_OPENED, propContextOpenedProperties(r.propType));
                  setSelectedPlayer({
                    playerId: r.playerId,
                    playerName: r.playerName,
                    propType: r.propType,
                    side: r.side,
                    lineValue: r.lineValue,
                    gameId: r.gameId,
                  });
                }}
                onSave={() => toggleSavedProp(r)}
                onCompare={() => {
                  completeChecklistItem('compare_opened');
                  trackEvent(PROP_OPENED, propOpenedProperties(r.propType));
                  setSelectedMarket({
                    gameId: r.gameId,
                    playerId: r.playerId,
                    playerName: r.playerName,
                    propType: r.propType,
                    side: r.side,
                    lineValue: r.lineValue,
                    sportsbook: r.sportsbook,
                    oddsAmerican: r.oddsAmerican,
                    snapshotAt: r.snapshotAt,
                  });
                }}
                onPaper={() => addToPaper(r)}
                onParlay={() => addToParlay(r)}
              />
            );
          })
        )}
      </div>
      <div className="hidden lg:block bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#F8FBFA] border-b border-[#DCE9EA]">
              <tr className="text-[#4a6366]">
                <th className="py-2 px-2 font-medium">Player</th>
                <th className="py-2 px-2 font-medium">Prop</th>
                <th className="py-2 px-2 font-medium">Side</th>
                <th className="py-2 px-2 font-medium text-right">Line</th>
                <th className="py-2 px-2 font-medium">Book</th>
                <th className="py-2 px-2 font-medium text-right">Odds</th>
                <th className="py-2 px-2 font-medium">Value</th>
                <th className="py-2 px-2 font-medium text-right">Confidence</th>
                {showAdvancedMetrics ? (
                  <>
                    <th className="py-2 px-2 font-medium text-right" title="Sportsbook implied probability">
                      Market P
                    </th>
                    <th
                      className="py-2 px-2 font-medium text-right"
                      title="Estimated win probability after calibration and market anchoring — not an independent model edge"
                    >
                      Est. P
                    </th>
                    <th className="py-2 px-2 font-medium text-right" title="Estimated EV after market anchoring">
                      Est. EV
                    </th>
                    <th className="py-2 px-2 font-medium text-right" title="Court Context statistical projection">
                      Proj
                    </th>
                    <th className="py-2 px-2 font-medium text-right" title="Projection minus market line">
                      Gap
                    </th>
                  </>
                ) : null}
                <th className="py-2 px-2 font-medium">
                  {marketContext === 'historical' ? 'Closed' : 'Updated'}
                </th>
                <th className="py-2 px-2 font-medium w-[72px]">Save</th>
                <th className="py-2 px-2 font-medium w-[88px]" data-coachmark="props-compare">Compare</th>
                <th className="py-2 px-2 font-medium w-[72px]">Paper</th>
                <th className="py-2 px-2 font-medium w-[80px]" data-coachmark="props-add-parlay">Parlay</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showAdvancedMetrics ? 18 : 13} className="py-8 text-center text-[#4a6366]">
                    {(() => {
                      const copy = propsExplorerEmptyCopy({
                        frozen: Boolean(meta?.ingestionFrozen),
                        dateLabel: getDateLabel(date),
                        marketContext,
                      });
                      return (
                        <div className="space-y-2 px-4">
                          <p className="text-sm text-[#063f46]">{copy.title}</p>
                          <p className="text-xs text-[#4a6366]">{copy.detail}</p>
                          {gameId.trim() ? (
                            <p className="text-xs">
                              <Link
                                href={gameDetailHref(gameId.trim())}
                                className="text-[#075B5C] hover:underline"
                              >
                                Back to game
                              </Link>
                            </p>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const paperKey = `${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}`;
                  const saveKey = buildSavedPropKey(r);
                  const isSaved = Boolean(savedPropIdByKey[saveKey]);
                  const parlayOffer = rowToParlayOfferInput(r);
                  const isOnParlay = isOfferSelected(selectedParlayLegs, parlayOffer);
                  return (
                  <tr
                    key={`${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}-${idx}`}
                    className="border-b border-[#DCE9EA] hover:bg-[#f7f9f7]"
                  >
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1 min-w-0 max-w-[160px]">
                        <button
                          type="button"
                          onClick={() => {
                            if (playerName.trim().length >= 2) {
                              trackEvent(
                                PLAYER_SEARCH_RESULT_OPENED,
                                playerSearchResultOpenedProperties('props_explorer')
                              );
                            }
                            trackEvent(PROP_CONTEXT_OPENED, propContextOpenedProperties(r.propType));
                            setSelectedPlayer({
                              playerId: r.playerId,
                              playerName: r.playerName,
                              propType: r.propType,
                              side: r.side,
                              lineValue: r.lineValue,
                              gameId: r.gameId,
                            });
                          }}
                          className="text-left text-[#075B5C] hover:underline truncate min-w-0 flex-1 text-xs"
                        >
                          {formatPlayerLabel(r.playerName, r.playerId)}
                        </button>
                        <Link
                          href={playerResearchHref({
                            playerId: r.playerId,
                            date,
                            gameId: r.gameId,
                            propType: r.propType,
                            side: r.side,
                            sportsbook: r.sportsbook,
                            lineValue: r.lineValue,
                          })}
                          className="shrink-0 p-0.5 rounded text-[#8aa0a3] hover:text-[#063f46]"
                          title="Open full profile"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-[#063f46] capitalize">
                      {(r.propType ?? '—').replace(/_/g, ' ')}
                    </td>
                    <td className="py-1.5 px-2 capitalize text-[#063f46]">{r.side ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">
                      {r.lineValue ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-[#4a6366] truncate max-w-[100px]">
                      {r.sportsbook ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">
                      {formatOdds(r.oddsAmerican)}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${explorerValueToneClass(r.marketContext === 'historical' ? null : r.ev)}`}
                        title={
                          r.marketContext === 'historical'
                            ? 'Historical closing line — estimated EV is not computed'
                            : r.ev != null && Number.isFinite(r.ev)
                              ? `Estimated EV (market-anchored): ${(r.ev * 100).toFixed(1)}%`
                              : 'No estimated EV available'
                        }
                      >
                        {explorerTableValueCopy(r.ev, r.marketContext)}
                      </span>
                    </td>
                    <td
                      className="py-1.5 px-2 text-right font-mono text-[#4a6366] capitalize"
                      title={
                        r.anchorDeltaAbsTrackB != null && Number.isFinite(r.anchorDeltaAbsTrackB)
                          ? `Anchor |Δ| vs calibrated: ${(r.anchorDeltaAbsTrackB * 100).toFixed(2)}%`
                          : undefined
                      }
                    >
                      {formatConfidenceSimple(r.confidenceTier)}
                    </td>
                    {showAdvancedMetrics ? (
                      <>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {formatPct(r.impliedProbability)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          {formatPct(r.modelProbability)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-[#20B95A]">
                          {formatPct(r.ev)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">
                          {r.projection != null && Number.isFinite(r.projection)
                            ? r.projection.toFixed(1)
                            : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">
                          {(() => {
                            const gap = projectionGap(r.projection, r.lineValue);
                            return gap != null ? formatProjectionGap(gap) : '—';
                          })()}
                        </td>
                      </>
                    ) : null}
                    <td className="py-1.5 px-2 text-[10px] text-[#8aa0a3] whitespace-nowrap">
                      {new Date(r.snapshotAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        disabled={savingPropKey !== null}
                        onClick={() => toggleSavedProp(r)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7] disabled:opacity-40"
                        title={isSaved ? 'Remove saved prop' : 'Save prop'}
                      >
                        {savingPropKey === saveKey ? '…' : isSaved ? 'Saved' : 'Save'}
                      </button>
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        onClick={() => {
                          completeChecklistItem('compare_opened');
                          trackEvent(PROP_OPENED, propOpenedProperties(r.propType));
                          setSelectedMarket({
                            gameId: r.gameId,
                            playerId: r.playerId,
                            playerName: r.playerName,
                            propType: r.propType,
                            side: r.side,
                            lineValue: r.lineValue,
                            sportsbook: r.sportsbook,
                            oddsAmerican: r.oddsAmerican,
                            snapshotAt: r.snapshotAt,
                          });
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
                        title="Compare books"
                      >
                        Compare
                      </button>
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        disabled={
                          addingPaperKey !== null ||
                          r.paperBetAllowed === false ||
                          r.marketContext === 'historical'
                        }
                        onClick={() => addToPaper(r)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#075B5C] text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40"
                        title={
                          r.paperBetAllowed === false || r.marketContext === 'historical'
                            ? 'Paper bets cannot be placed on completed historical games'
                            : 'Add to paper bets'
                        }
                      >
                        {addingPaperKey === paperKey ? '…' : 'Add'}
                      </button>
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        aria-label={isOnParlay ? 'Added to parlay' : 'Add to Parlay'}
                        aria-pressed={isOnParlay}
                        onClick={() => addToParlay(r)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          isOnParlay
                            ? 'border-[#075B5C] bg-[#F8FBFA] text-[#075B5C]'
                            : 'border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]'
                        }`}
                        title={isOnParlay ? 'Already added' : 'Add to Parlay'}
                      >
                        {isOnParlay ? 'Added' : '+ Parlay'}
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
        </div>

        <aside className="hidden xl:flex xl:flex-col gap-3 w-full xl:w-96 shrink-0 xl:sticky xl:top-16 xl:self-start xl:max-h-[calc(100vh-5rem)]">
          <PropsExplorerGameContextPanel gameId={effectiveGameId} />
          <div className="flex-1 min-h-0 flex flex-col min-h-[12rem] gap-3">
            {selectedMarket && isXlViewport ? (
              <PropsExplorerMarketPanel
                variant="sidebar"
                selection={selectedMarket}
                dateEt={date}
                onClose={() => setSelectedMarket(null)}
              />
            ) : null}
            {selectedPlayer && isXlViewport ? (
              <PropsExplorerPlayerPanel
                variant="sidebar"
                selection={selectedPlayer}
                researchDate={date}
                onClose={() => setSelectedPlayer(null)}
              />
            ) : null}
            {!selectedPlayer && !selectedMarket ? <PropsExplorerPlayerSidebarPlaceholder /> : null}
          </div>
        </aside>
      </div>

      {selectedPlayer && !isXlViewport ? (
        <PropsExplorerPlayerPanel
          variant="drawer"
          selection={selectedPlayer}
          researchDate={date}
          onClose={() => setSelectedPlayer(null)}
        />
      ) : null}
      {selectedMarket && !isXlViewport ? (
        <PropsExplorerMarketPanel
          variant="drawer"
          selection={selectedMarket}
          dateEt={date}
          onClose={() => setSelectedMarket(null)}
        />
      ) : null}
      <PropsExplorerParlayTray
        legs={selectedParlayLegs}
        onRemove={removeParlayLeg}
        onClear={clearParlay}
      />
    </main>
  );
}
