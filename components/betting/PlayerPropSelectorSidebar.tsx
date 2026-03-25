'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Minus, Target } from 'lucide-react';
import { usePlayerAnalysis } from '@/app/betting/players/[playerId]/components/PlayerAnalysisContext';
import { METRIC_TO_PROP_TYPE } from '@/lib/players/types';
import type { MetricKey } from '@/lib/players/types';

/**
 * Single useEffect is only for fetching props (async). Filter updates are synchronous like
 * BettingLinePanel: state from select/input → derived effectiveStat → filter. Reset on player
 * change is done via key={playerId} in the parent (remount = fresh state).
 */

export interface PlayerPropRow {
  gameId: number;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
  consensusProbability?: number | null;
  edgeProbability?: number | null;
  modelProbability?: number | null;
  ev?: number | null;
  projection?: number | null;
  snapshotAt: string;
  /** Track B.1 / EV ladder (optional; present when API returns `with_ev=1`). */
  confidenceTier?: 'high' | 'medium' | 'low' | null;
  isComboProp?: boolean;
  modelProbabilityTrackBRaw?: number | null;
  modelProbabilityTrackBCalibrated?: number | null;
  anchorDeltaAbsTrackB?: number | null;
  modelTrackVersion?: string | null;
}

interface PlayerPropSelectorSidebarProps {
  playerId: string;
  playerName: string;
  gameId?: number | null;
  /** Default line filter value (e.g. player points average). Used to seed the line filter. */
  defaultLineValue?: number | null;
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatEdge(edgeP: number | null | undefined): string {
  if (edgeP == null || Number.isNaN(edgeP)) return '—';
  const pct = edgeP * 100;
  const abs = Math.abs(pct);
  const sign = pct >= 0 ? '+' : '−';
  return `${sign}${abs.toFixed(1)}%`;
}

function formatEv(ev: number | null | undefined): string {
  if (ev == null || !Number.isFinite(ev)) return '—';
  const pct = ev * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function isOverUnderSide(p: PlayerPropRow): boolean {
  return (p.marketType ?? '').toLowerCase() === 'over_under' && (p.side === 'over' || p.side === 'under');
}

const LINE_STEP = 0.5;

/** Round to nearest 0.5 so half-point lines group and compare consistently (avoids float noise). */
function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function lineMatches(filterValue: number | null, lineValue: number | null): boolean {
  if (filterValue == null || lineValue == null) return filterValue == null;
  return roundToHalf(filterValue) === roundToHalf(lineValue);
}

/** True if lineValue >= filterValue (for over/at least: "this line and up"). */
function lineAtOrAbove(filterValue: number, lineValue: number | null): boolean {
  if (lineValue == null) return false;
  return roundToHalf(lineValue) >= roundToHalf(filterValue);
}

/** True if lineValue <= filterValue (for under: "this line and down"). */
function lineAtOrBelow(filterValue: number, lineValue: number | null): boolean {
  if (lineValue == null) return false;
  return roundToHalf(lineValue) <= roundToHalf(filterValue);
}

/** Median line value for the given prop type (from loaded props). Returns null if none. */
function medianLineForStat(props: PlayerPropRow[], stat: string): number | null {
  const relevant =
    stat === 'all'
      ? props
      : props.filter((p) => p.propType != null && p.propType.toLowerCase() === stat.toLowerCase());
  const lines = relevant
    .map((p) => p.lineValue)
    .filter((v): v is number => v != null && !Number.isNaN(v))
    .map(roundToHalf);
  const unique = Array.from(new Set(lines)).sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const mid = Math.floor(unique.length / 2);
  return unique.length % 2 === 1 ? unique[mid]! : (unique[mid - 1]! + unique[mid]!) / 2;
}

function formatLineValue(lineValue: number | null): string {
  if (lineValue == null || Number.isNaN(lineValue)) return '—';
  return String(roundToHalf(lineValue));
}

export function PlayerPropSelectorSidebar({
  playerId,
  playerName,
  gameId,
  defaultLineValue,
}: PlayerPropSelectorSidebarProps) {
  const [props, setProps] = useState<PlayerPropRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStat, setFilterStat] = useState<string>('points');
  const [filterOutcome, setFilterOutcome] = useState<string>('over');
  const defaultLine = useMemo(() => {
    if (defaultLineValue != null && !Number.isNaN(defaultLineValue)) {
      return roundToHalf(defaultLineValue);
    }
    return null;
  }, [defaultLineValue]);
  const [filterLineRaw, setFilterLineRaw] = useState<string>(() =>
    defaultLine != null ? String(defaultLine) : ''
  );
  const [showBestEdgeOnly, setShowBestEdgeOnly] = useState(false);
  const filterLineNum: number | null =
    filterLineRaw.trim() === ''
      ? null
      : (() => {
          const n = parseFloat(filterLineRaw);
          return Number.isNaN(n) ? null : n;
        })();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const url = new URL(`/api/betting/players/${playerId}/props`, window.location.origin);
        if (gameId != null) url.searchParams.set('game_id', String(gameId));
        url.searchParams.set('with_consensus', '1');
        url.searchParams.set('with_ev', '1');
        const res = await fetch(url.toString());
        if (!res.ok) {
          setProps([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) setProps(data.props ?? []);
      } catch {
        if (!cancelled) setProps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [playerId, gameId]);

  const analysis = usePlayerAnalysis();
  const contextSyncRef = useRef(false);
  const prevContextMetricRef = useRef<MetricKey | null>(null);
  const prevContextLineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analysis) return;
    const metricChanged = analysis.activeMetric !== prevContextMetricRef.current;
    const lineChanged = analysis.bettingLine !== prevContextLineRef.current;
    prevContextMetricRef.current = analysis.activeMetric;
    prevContextLineRef.current = analysis.bettingLine;

    if (!metricChanged && !lineChanged) return;

    if (metricChanged) {
      const propType = METRIC_TO_PROP_TYPE[analysis.activeMetric];
      setFilterStat(propType);
    }
    if (analysis.bettingLine != null) {
      contextSyncRef.current = true;
      setFilterLineRaw(String(roundToHalf(analysis.bettingLine)));
    }
  }, [analysis?.activeMetric, analysis?.bettingLine]);

  // When user switches prop type, set line to median line for that stat (or clear for "all").
  // Skipped when the change originated from context sync (the context provides its own line).
  useEffect(() => {
    if (contextSyncRef.current) {
      contextSyncRef.current = false;
      return;
    }
    if (props.length === 0) return;
    if (filterStat === 'all') {
      setFilterLineRaw('');
      return;
    }
    const median = medianLineForStat(props, filterStat);
    setFilterLineRaw(median != null ? String(median) : '');
  }, [filterStat, props]);

  const propTypes = Array.from(new Set(props.map((p) => p.propType).filter(Boolean))) as string[];
  propTypes.sort();

  // Derived during render: if current filterStat isn't in the options, show points-like or "all".
  // No useEffect – same pattern as BettingLinePanel: selection drives state, we just derive display/filter value.
  const effectiveStat =
    filterStat === 'all' || propTypes.includes(filterStat)
      ? filterStat
      : (propTypes.find((t) => (t ?? '').toLowerCase().includes('point')) ?? 'all');

  const filtered = props.filter((p) => {
    const statMatch =
      effectiveStat === 'all' ||
      (p.propType != null && p.propType.toLowerCase() === effectiveStat.toLowerCase());
    if (!statMatch) return false;

    // Over = over/under "over" + milestone (any "over this line" bet)
    if (filterOutcome === 'over' && p.side !== 'over' && p.side !== 'milestone') return false;
    if (filterOutcome === 'under' && p.side !== 'under') return false;

    if (filterLineNum != null) {
      if (filterOutcome === 'over') {
        if (!lineAtOrAbove(filterLineNum, p.lineValue)) return false;
      } else if (filterOutcome === 'under') {
        if (!lineAtOrBelow(filterLineNum, p.lineValue)) return false;
      } else {
        if (!lineMatches(filterLineNum, p.lineValue)) return false;
      }
    }

    return true;
  });

  type GroupKey = string;
  const groupKey = (p: PlayerPropRow): GroupKey =>
    `${p.propType ?? ''}|${p.side ?? ''}|${p.lineValue != null ? roundToHalf(p.lineValue) : 'null'}`;

  const groups = filtered.reduce<Map<GroupKey, PlayerPropRow[]>>((acc, p) => {
    const key = groupKey(p);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(p);
    return acc;
  }, new Map());

  const groupsWithBest = Array.from(groups.entries()).map(([key, rows]) => {
    const bestOdds = Math.max(...rows.map((r) => r.oddsAmerican ?? -Infinity));
    const bestEdge = Math.max(...rows.map((r) => (r.edgeProbability ?? -Infinity)));
    const bestEv = Math.max(...rows.map((r) => (r.ev != null && Number.isFinite(r.ev) ? r.ev : -Infinity)));
    const hasAnyEv = rows.some((r) => r.ev != null && Number.isFinite(r.ev));
    return {
      key,
      rows,
      bestOdds: bestOdds === -Infinity ? null : bestOdds,
      bestEdge: bestEdge === -Infinity ? null : bestEdge,
      bestEv: bestEv === -Infinity ? null : bestEv,
      hasAnyEv,
    };
  });

  const selectClass =
    'rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-0 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]';
  const optionStyle = { backgroundColor: '#111827', color: '#fff' };

  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#00d4ff]/20">
            <Target className="w-4 h-4 text-[#00d4ff]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">{playerName || 'Player'}</h3>
            <p className="text-[10px] text-muted-foreground">Prop lines</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-white/5 flex flex-wrap gap-2 shrink-0">
        <select
          value={effectiveStat}
          onChange={(e) => setFilterStat(e.target.value)}
          className={selectClass}
          aria-label="Filter by stat"
        >
          <option value="all" style={optionStyle}>All stats</option>
          {propTypes.map((t) => (
            <option key={t} value={t} style={optionStyle}>
              {(t ?? '').replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={filterOutcome}
          onChange={(e) => setFilterOutcome(e.target.value)}
          className={selectClass}
          aria-label="Filter by outcome"
        >
          <option value="all" style={optionStyle}>All</option>
          <option value="over" style={optionStyle}>Over</option>
          <option value="under" style={optionStyle}>Under</option>
        </select>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-gray-900 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const n = filterLineNum ?? defaultLine ?? 0;
              setFilterLineRaw(String(Math.max(0, n - LINE_STEP)));
            }}
            className="p-1.5 text-white hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]"
            aria-label="Decrease line"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="number"
            step={LINE_STEP}
            min={0}
            value={filterLineRaw}
            onChange={(e) => setFilterLineRaw(e.target.value)}
            placeholder="Line"
            className="w-14 bg-transparent text-white text-xs py-1.5 px-2 text-center focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Filter by line value"
          />
          <button
            type="button"
            onClick={() => {
              const n = filterLineNum ?? defaultLine ?? 0;
              setFilterLineRaw(String(n + LINE_STEP));
            }}
            className="p-1.5 text-white hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#00d4ff]"
            aria-label="Increase line"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900 text-xs text-white py-1.5 px-2 cursor-pointer hover:bg-white/5 focus-within:ring-1 focus-within:ring-[#00d4ff]">
          <input
            type="checkbox"
            checked={showBestEdgeOnly}
            onChange={(e) => setShowBestEdgeOnly(e.target.checked)}
            className="rounded border-white/20 bg-gray-800 text-[#00d4ff] focus:ring-[#00d4ff]"
            aria-label="Show best edge only"
          />
          <span>Best edge only</span>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground py-4">Loading props…</p>
        ) : groupsWithBest.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            No props match. Try a lower line, different stat, or outcome.
          </p>
        ) : (
          groupsWithBest.map(({ key, rows, bestOdds, bestEdge, bestEv, hasAnyEv }) => {
            const [propType, side, lineVal] = key.split('|');
            const lineValue = lineVal === 'null' ? null : parseFloat(lineVal);
            const isOver = side === 'over' || side === 'milestone';
            const rowsToShow =
              showBestEdgeOnly
                ? rows.filter((r) => {
                    if (hasAnyEv && bestEv != null && r.ev != null && Number.isFinite(r.ev) && r.ev === bestEv)
                      return true;
                    const hasEdge =
                      isOverUnderSide(r) && r.edgeProbability != null && Number.isFinite(r.edgeProbability);
                    const isBestByEdge =
                      hasEdge && bestEdge != null && r.edgeProbability != null && r.edgeProbability === bestEdge;
                    const isBestByOdds =
                      !hasEdge &&
                      bestOdds != null &&
                      r.oddsAmerican != null &&
                      r.oddsAmerican === bestOdds;
                    return isBestByEdge || isBestByOdds;
                  })
                : rows;
            const rowsSortedByEdge = [...rowsToShow].sort((a, b) => {
              const evA = a.ev != null && Number.isFinite(a.ev) ? a.ev : -Infinity;
              const evB = b.ev != null && Number.isFinite(b.ev) ? b.ev : -Infinity;
              if (evB !== evA) return evB - evA;
              return (b.edgeProbability ?? -Infinity) - (a.edgeProbability ?? -Infinity);
            });
            return (
              <div
                key={key}
                className="p-3 rounded-lg bg-white/[0.03] border border-white/5"
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {isOver ? (
                    <Plus className="w-3.5 h-3.5 text-[#39ff14]" />
                  ) : (
                    <Minus className="w-3.5 h-3.5 text-[#ff4757]" />
                  )}
                  <span className="text-[10px] text-muted-foreground capitalize">
                    {(propType ?? '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs font-mono text-white">
                    {formatLineValue(lineValue)}
                  </span>
                  {rowsToShow.some((r) => r.projection != null && Number.isFinite(r.projection)) && (
                    <span className="text-[10px] text-muted-foreground">
                      (model {formatLineValue(rowsToShow.find((r) => r.projection != null)?.projection ?? null)})
                    </span>
                  )}
                </div>
                <ul className="space-y-1">
                  {rowsSortedByEdge.map((r) => {
                    const hasEv = r.ev != null && Number.isFinite(r.ev);
                    const hasEdge =
                      isOverUnderSide(r) && r.edgeProbability != null && Number.isFinite(r.edgeProbability);
                    const isBestByEv =
                      hasAnyEv && bestEv != null && hasEv && r.ev === bestEv;
                    const isBestByEdge =
                      !hasAnyEv && hasEdge && bestEdge != null && r.edgeProbability != null && r.edgeProbability === bestEdge;
                    const isBestByOdds =
                      !hasAnyEv &&
                      !hasEdge &&
                      bestOdds != null &&
                      r.oddsAmerican != null &&
                      r.oddsAmerican === bestOdds;
                    const isBest = isBestByEv || isBestByEdge || isBestByOdds;
                    return (
                      <li
                        key={`${r.sportsbook}-${r.oddsAmerican}`}
                        className={`flex items-center justify-between text-xs py-1 px-2 rounded ${
                          isBest ? 'bg-[#00d4ff]/15 border border-[#00d4ff]/30' : ''
                        }`}
                      >
                        <span className="text-muted-foreground truncate">
                          {r.sportsbook ?? '—'}
                        </span>
                        <span className="font-mono text-white shrink-0 ml-2 flex items-center gap-2">
                          <span className="text-xs">
                            EV {formatEv(r.ev)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Edge {hasEdge ? formatEdge(r.edgeProbability) : '—'}
                          </span>
                          <span>
                            {formatOdds(r.oddsAmerican)}
                            {isBest && (
                              <span className="ml-1.5 text-[10px] text-[#00d4ff] font-medium">
                                Best
                              </span>
                            )}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
