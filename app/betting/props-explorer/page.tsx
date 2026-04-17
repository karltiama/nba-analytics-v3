'use client';

import { use, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search, CalendarDays, ListFilter, ExternalLink } from 'lucide-react';
import { getTodayET, addDaysET, getDateLabel } from '@/components/betting';
import {
  PropsExplorerPlayerPanel,
  PropsExplorerPlayerSidebarPlaceholder,
  type PropsExplorerSelection,
} from '@/components/betting/PropsExplorerPlayerPanel';
import { PropsExplorerGameContextPanel } from '@/components/betting/PropsExplorerGameContextPanel';
import { PropsExplorerTableSkeleton } from '@/components/betting/PropsExplorerTableSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

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
  calibrationVersion: string;
  confidenceTier?: 'high' | 'medium' | 'low' | null;
  anchorDeltaAbsTrackB?: number | null;
};

type ExplorerMeta = {
  totalMatching: number;
  evSelectedTrack: string;
  calibrationVersion: string;
  computedAt: string;
  evFetchCap: number | null;
  sort: string;
  dir: string;
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

type ValueGrade = 'good' | 'fair' | 'bad' | 'unknown';

function getValueGrade(ev: number | null | undefined): ValueGrade {
  if (ev == null || !Number.isFinite(ev)) return 'unknown';
  if (ev > 0.03) return 'good';
  if (ev < -0.02) return 'bad';
  return 'fair';
}

function getValueCopy(ev: number | null | undefined): string {
  const grade = getValueGrade(ev);
  if (grade === 'good') return 'Good Value';
  if (grade === 'bad') return 'Bad Value';
  if (grade === 'fair') return 'Fair Value';
  return 'No Signal';
}

function getValueToneClass(ev: number | null | undefined): string {
  const grade = getValueGrade(ev);
  if (grade === 'good') return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40';
  if (grade === 'bad') return 'bg-rose-500/15 text-rose-200 border-rose-400/40';
  if (grade === 'fair') return 'bg-amber-500/15 text-amber-200 border-amber-400/40';
  return 'bg-white/5 text-muted-foreground border-white/10';
}

function formatConfidenceSimple(confidence: ExplorerRow['confidenceTier']): string {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';
  if (confidence === 'low') return 'Low';
  return '—';
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
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

const SORT_OPTIONS = [
  { value: 'snapshot_at', label: 'Snapshot time' },
  { value: 'ev', label: 'EV' },
  { value: 'confidence', label: 'Confidence tier' },
  { value: 'odds_american', label: 'American odds' },
] as const;

const AVAILABLE_BOOKS = [
  { id: 'draftkings', label: 'DraftKings' },
  { id: 'fanduel', label: 'FanDuel' },
  { id: 'betmgm', label: 'BetMGM' },
  { id: 'caesars', label: 'Caesars' },
  { id: 'betrivers', label: 'BetRivers' },
  { id: 'fanatics', label: 'Fanatics' },
];

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
  const [selectedPlayer, setSelectedPlayer] = useState<PropsExplorerSelection | null>(null);
  const [isXlViewport, setIsXlViewport] = useState(false);
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);

  const effectiveGameId = useMemo(() => {
    const fromFilter = gameId.trim();
    if (fromFilter) return fromFilter;
    if (selectedPlayer?.gameId != null) return String(selectedPlayer.gameId);
    return null;
  }, [gameId, selectedPlayer]);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const sync = () => setIsXlViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/betting/games?date=${encodeURIComponent(date)}`);
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
        if (minEv.trim() !== '' && !Number.isNaN(parseFloat(minEv))) {
          u.searchParams.set('min_ev', minEv.trim());
        }
        const res = await fetch(u.toString());
        if (!res.ok) throw new Error('Failed to load props');
        const data = await res.json();
        if (!cancelled) {
          const hasExplicitDate = Boolean(searchParams.get('date'));
          const noFiltersApplied =
            !gameId.trim() &&
            !playerName.trim() &&
            !propType.trim() &&
            side === 'all' &&
            !sportsbook.trim() &&
            minEv.trim() === '';
          // If default "today" has no props yet, fall back once to yesterday.
          if (Array.isArray(data.rows) && data.rows.length === 0 && !hasExplicitDate && noFiltersApplied) {
            updateParams({ date: addDaysET(date, -1), offset: '0' });
            return;
          }
          setRows(data.rows ?? []);
          setMeta(data.meta ?? null);
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
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]';
  const inputClass =
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]';

  const evSortActive = ['ev', 'ev_track_a', 'ev_track_b'].includes(sort);
  const canPrev = offset > 0;
  const canNext = rows.length === limit;

  const addToPaper = useCallback(
    async (r: ExplorerRow) => {
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
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to save prop');
        const savedId = data?.savedProp?.id;
        if (savedId) {
          setSavedPropIdByKey((prev) => ({ ...prev, [key]: String(savedId) }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save prop');
      } finally {
        setSavingPropKey(null);
      }
    },
    [buildSavedPropKey, savedPropIdByKey]
  );

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Props Explorer</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Simple mode highlights Good/Fair/Bad value from your model edge.
          </p>
        </div>
        {showAdvancedMetrics && meta ? (
          <p className="text-[10px] text-muted-foreground font-mono">
            {meta.calibrationVersion} · {new Date(meta.computedAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <div className="glass-card w-full rounded-xl border border-white/5 mb-6 overflow-hidden">
        {/* Context Row */}
        <div className="bg-white/5 p-3 sm:px-4 border-b border-white/5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1 shrink-0 bg-gray-900/50 p-1 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, -1), offset: '0' })}
              className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-2">
              <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-white min-w-[80px] text-center">
                {getDateLabel(date)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, 1), offset: '0' })}
              className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => updateParams({ date: getTodayET(), offset: '0' })}
              className="px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-white/10 hover:text-white transition-colors rounded"
            >
              Today
            </button>
          </div>

          <select
            className={`${selectClass} min-w-[200px] border-white/5`}
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
          </select>
        </div>

        {/* Main Filters Grid */}
        <div className="p-3 sm:p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div className="relative col-span-2 md:col-span-1">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <input
                className={`${inputClass} pl-8`}
                placeholder="Player Name"
                value={playerName}
                onChange={(e) => updateParams({ player_name: e.target.value || null, offset: '0' })}
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
              />
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <span className="text-muted-foreground text-xs font-medium">EV+</span>
              </div>
            </div>

            <div className="col-span-2 md:col-span-4 lg:col-span-1 flex items-center gap-2">
              <select
                className={`${selectClass} flex-1`}
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value, offset: '0' })}
                aria-label="Sort by"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
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

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium shrink-0">
              <ListFilter className="w-3.5 h-3.5" />
              <span>Sportsbooks:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Sportsbooks">
              {AVAILABLE_BOOKS.map((book) => {
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
                        ? 'bg-[#00d4ff]/20 border-[#00d4ff]/50 text-[#00d4ff] shadow-[0_0_10px_rgba(0,212,255,0.1)]' 
                        : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {book.label}
                  </button>
                );
              })}
            </div>
          </div>

          {evSortActive && meta?.evFetchCap != null && (
            <p className="text-[10px] text-amber-200/90 pt-1">
              EV sorts scan up to {meta.evFetchCap} freshest rows, then sort — global order is approximate
              for very large slates.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex-1 min-w-0">
      {error && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757] mb-4">
          <p className="text-sm text-[#ff4757]">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-muted-foreground">
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
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-white/10 bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"
            aria-pressed={showAdvancedMetrics}
          >
            {showAdvancedMetrics ? 'Hide advanced metrics' : 'Show advanced metrics'}
          </button>
          <button
            type="button"
            disabled={!canPrev || loading}
            onClick={() => updateParams({ offset: String(Math.max(0, offset - limit)) })}
            className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10 text-white"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!canNext || loading}
            onClick={() => updateParams({ offset: String(offset + limit) })}
            className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10 text-white"
          >
            Next
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <PropsExplorerTableSkeleton />
      ) : (
      <div className="glass-card rounded-xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
              <tr className="text-muted-foreground">
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
                    <th className="py-2 px-2 font-medium text-right">Implied</th>
                    <th className="py-2 px-2 font-medium text-right">Model</th>
                    <th className="py-2 px-2 font-medium text-right">EV</th>
                    <th className="py-2 px-2 font-medium text-right">Proj</th>
                  </>
                ) : null}
                <th className="py-2 px-2 font-medium">Updated</th>
                <th className="py-2 px-2 font-medium w-[72px]">Save</th>
                <th className="py-2 px-2 font-medium w-[72px]">Paper</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showAdvancedMetrics ? 15 : 11} className="py-8 text-center text-muted-foreground">
                    No rows. Adjust filters or date.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const paperKey = `${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}`;
                  const saveKey = buildSavedPropKey(r);
                  const isSaved = Boolean(savedPropIdByKey[saveKey]);
                  return (
                  <tr
                    key={`${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}-${idx}`}
                    className="border-b border-white/5 hover:bg-white/3"
                  >
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1 min-w-0 max-w-[160px]">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPlayer({
                              playerId: r.playerId,
                              playerName: r.playerName,
                              propType: r.propType,
                              lineValue: r.lineValue,
                              gameId: r.gameId,
                            })
                          }
                          className="text-left text-[#00d4ff] hover:underline truncate min-w-0 flex-1 text-xs"
                        >
                          {formatPlayerLabel(r.playerName, r.playerId)}
                        </button>
                        <Link
                          href={`/betting/players/${r.playerId}`}
                          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-white"
                          title="Open full profile"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-white capitalize">
                      {(r.propType ?? '—').replace(/_/g, ' ')}
                    </td>
                    <td className="py-1.5 px-2 capitalize">{r.side ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-white">
                      {r.lineValue ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[100px]">
                      {r.sportsbook ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-white">
                      {formatOdds(r.oddsAmerican)}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getValueToneClass(r.ev)}`}
                        title={
                          r.ev != null && Number.isFinite(r.ev)
                            ? `Model edge: ${(r.ev * 100).toFixed(1)}%`
                            : 'No model edge available'
                        }
                      >
                        {getValueCopy(r.ev)}
                      </span>
                    </td>
                    <td
                      className="py-1.5 px-2 text-right font-mono text-muted-foreground capitalize"
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
                        <td className="py-1.5 px-2 text-right font-mono text-[#39ff14]">
                          {formatPct(r.ev)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-white">
                          {r.projection != null && Number.isFinite(r.projection)
                            ? r.projection.toFixed(1)
                            : '—'}
                        </td>
                      </>
                    ) : null}
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(r.snapshotAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        disabled={savingPropKey !== null}
                        onClick={() => toggleSavedProp(r)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40"
                        title={isSaved ? 'Remove saved prop' : 'Save prop'}
                      >
                        {savingPropKey === saveKey ? '…' : isSaved ? 'Saved' : 'Save'}
                      </button>
                    </td>
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        disabled={addingPaperKey !== null}
                        onClick={() => addToPaper(r)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#00d4ff]/40 text-[#8fefff] hover:bg-[#00d4ff]/15 disabled:opacity-40"
                        title="Add to paper bets"
                      >
                        {addingPaperKey === paperKey ? '…' : 'Add'}
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
      )}
        </div>

        <aside className="hidden xl:flex xl:flex-col gap-3 w-full xl:w-96 shrink-0 xl:sticky xl:top-16 xl:self-start xl:max-h-[calc(100vh-5rem)]">
          <PropsExplorerGameContextPanel gameId={effectiveGameId} />
          <div className="flex-1 min-h-0 flex flex-col min-h-[12rem]">
            {selectedPlayer && isXlViewport ? (
              <PropsExplorerPlayerPanel
                variant="sidebar"
                selection={selectedPlayer}
                onClose={() => setSelectedPlayer(null)}
              />
            ) : (
              <PropsExplorerPlayerSidebarPlaceholder />
            )}
          </div>
        </aside>
      </div>

      {selectedPlayer && !isXlViewport ? (
        <PropsExplorerPlayerPanel
          variant="drawer"
          selection={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      ) : null}
    </main>
  );
}
