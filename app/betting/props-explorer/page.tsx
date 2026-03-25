'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTodayET, addDaysET, getDateLabel } from '@/components/betting';

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
  evTrackA: number | null;
  modelProbabilityTrackA: number | null;
  evTrackB: number | null;
  modelProbabilityTrackB: number | null;
  evSelectedTrack: string;
  calibrationVersion: string;
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

type PageProps = {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
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
  { value: 'ev', label: 'EV (selected track)' },
  { value: 'ev_track_a', label: 'EV Track A' },
  { value: 'ev_track_b', label: 'EV Track B' },
  { value: 'odds_american', label: 'American odds' },
] as const;

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
  const playerId = searchParams.get('player_id') ?? '';
  const propType = searchParams.get('prop_type') ?? '';
  const side = searchParams.get('side') ?? 'all';
  const sportsbook = searchParams.get('sportsbook') ?? '';
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
        if (playerId.trim()) u.searchParams.set('player_id', playerId.trim());
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
  }, [date, gameId, playerId, propType, side, sportsbook, sort, dir, minEv, limit, offset]);

  const selectClass =
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]';
  const inputClass =
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 w-full min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]';

  const evSortActive = ['ev', 'ev_track_a', 'ev_track_b'].includes(sort);
  const canPrev = offset > 0;
  const canNext = rows.length === limit;

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Props Explorer</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Filter slate props with EV (selected track: {meta?.evSelectedTrack ?? '…'}) and Track A/B
            reference columns.
          </p>
        </div>
        {meta && (
          <p className="text-[10px] text-muted-foreground font-mono">
            {meta.calibrationVersion} · {new Date(meta.computedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="glass-card rounded-xl p-3 sm:p-4 space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, -1), offset: '0' })}
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-white min-w-[100px] text-center">
              {getDateLabel(date)}
            </span>
            <button
              type="button"
              onClick={() => updateParams({ date: addDaysET(date, 1), offset: '0' })}
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => updateParams({ date: getTodayET(), offset: '0' })}
              className="ml-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-white/10 hover:text-white"
            >
              Today
            </button>
          </div>

          <select
            className={selectClass}
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

          <input
            className={`${inputClass} w-24`}
            placeholder="Player ID"
            value={playerId}
            onChange={(e) => updateParams({ player_id: e.target.value || null, offset: '0' })}
            aria-label="Player ID"
          />

          <input
            className={`${inputClass} w-28`}
            placeholder="Prop type"
            value={propType}
            onChange={(e) => updateParams({ prop_type: e.target.value || null, offset: '0' })}
            aria-label="Prop type prefix"
          />

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

          <input
            className={`${inputClass} w-32`}
            placeholder="Sportsbook"
            value={sportsbook}
            onChange={(e) => updateParams({ sportsbook: e.target.value || null, offset: '0' })}
            aria-label="Sportsbook"
          />

          <select
            className={selectClass}
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
            className={selectClass}
            value={dir}
            onChange={(e) => updateParams({ dir: e.target.value, offset: '0' })}
            aria-label="Sort direction"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>

          <input
            className={`${inputClass} w-20`}
            placeholder="Min EV"
            value={minEv}
            onChange={(e) => updateParams({ min_ev: e.target.value || null, offset: '0' })}
            aria-label="Minimum EV"
          />
        </div>

        {evSortActive && meta?.evFetchCap != null && (
          <p className="text-[10px] text-amber-200/90">
            EV sorts scan up to {meta.evFetchCap} freshest rows, then sort — global order is approximate
            for very large slates.
          </p>
        )}
      </div>

      {error && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757] mb-4">
          <p className="text-sm text-[#ff4757]">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-muted-foreground">
        <span>
          {loading ? 'Loading…' : `${rows.length} rows`}
          {meta != null && ` · ${meta.totalMatching.toLocaleString()} matching`}
        </span>
        <div className="flex items-center gap-2">
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

      <div className="glass-card rounded-xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
              <tr className="text-muted-foreground">
                <th className="py-2 px-2 font-medium">Game</th>
                <th className="py-2 px-2 font-medium">Player</th>
                <th className="py-2 px-2 font-medium">Prop</th>
                <th className="py-2 px-2 font-medium">Side</th>
                <th className="py-2 px-2 font-medium text-right">Line</th>
                <th className="py-2 px-2 font-medium">Book</th>
                <th className="py-2 px-2 font-medium text-right">Odds</th>
                <th className="py-2 px-2 font-medium text-right">Implied</th>
                <th className="py-2 px-2 font-medium text-right">Model</th>
                <th className="py-2 px-2 font-medium text-right">EV</th>
                <th className="py-2 px-2 font-medium text-right">EV A</th>
                <th className="py-2 px-2 font-medium text-right">EV B</th>
                <th className="py-2 px-2 font-medium text-right">Proj</th>
                <th className="py-2 px-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-muted-foreground">
                    No rows. Adjust filters or date.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={`${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${r.sportsbook}-${r.oddsAmerican}-${idx}`}
                    className="border-b border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="py-1.5 px-2 font-mono text-muted-foreground">
                      <Link
                        href={`/betting/games/${r.gameId}`}
                        className="text-[#00d4ff] hover:underline"
                      >
                        {r.gameId}
                      </Link>
                    </td>
                    <td className="py-1.5 px-2">
                      <Link
                        href={`/betting/players/${r.playerId}`}
                        className="text-[#00d4ff] hover:underline truncate max-w-[140px] block"
                      >
                        {formatPlayerLabel(r.playerName, r.playerId)}
                      </Link>
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
                    <td className="py-1.5 px-2 text-right font-mono">
                      {formatPct(r.impliedProbability)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {formatPct(r.modelProbability)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#39ff14]">
                      {formatPct(r.ev)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                      {formatPct(r.evTrackA)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                      {formatPct(r.evTrackB)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-white">
                      {r.projection != null && Number.isFinite(r.projection)
                        ? r.projection.toFixed(1)
                        : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(r.snapshotAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
