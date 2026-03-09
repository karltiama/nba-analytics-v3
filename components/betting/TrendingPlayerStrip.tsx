'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { TrendingUp, Flame, ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type TrendingStat = 'pts' | 'reb' | 'ast' | '3pm' | 'pra';

interface StripPlayer {
  player_id: string;
  full_name: string;
  team_abbr: string;
  next_opponent_abbr: string | null;
  l5_avg: number;
  season_avg: number;
  trend_score: number;
  trends: {
    pts: number;
    reb: number;
    ast: number;
    threePM: number;
    pra: number;
  };
}

const STAT_TABS: { key: TrendingStat; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: '3pm', label: '3PM' },
  { key: 'pra', label: 'PRA' },
];

const STAT_LABELS: Record<TrendingStat, string> = {
  pts: 'PTS',
  reb: 'REB',
  ast: 'AST',
  '3pm': '3PM',
  pra: 'PRA',
};

function getBadge(player: StripPlayer, stat: TrendingStat): { label: string; color: string } | null {
  const score = player.trend_score;
  const t = player.trends;

  // "HOT" badge when trend_score is large relative to season avg
  if (player.season_avg > 0 && score / player.season_avg >= 0.20) {
    return { label: 'HOT', color: '#ff6b35' };
  }

  // Secondary badges for other stats trending up alongside the primary
  const secondaryThreshold = 1.5;
  if (stat !== 'pra' && t.pra >= secondaryThreshold * 3) {
    return { label: 'PRA\u2191', color: '#bf5af2' };
  }
  if (stat !== 'ast' && t.ast >= secondaryThreshold) {
    return { label: 'AST\u2191', color: '#00d4ff' };
  }
  if (stat !== 'pts' && t.pts >= secondaryThreshold * 2) {
    return { label: 'PTS\u2191', color: '#39ff14' };
  }

  return null;
}

function TrendingCard({
  player,
  rank,
  stat,
}: {
  player: StripPlayer;
  rank: number;
  stat: TrendingStat;
}) {
  const diff = player.trend_score;
  const badge = getBadge(player, stat);

  return (
    <Link
      href={`/betting/players/${player.player_id}`}
      className="glass-card rounded-xl p-3 min-w-[172px] max-w-[172px] shrink-0
                 border border-white/5 hover:border-[#00d4ff]/30
                 transition-all duration-200 cursor-pointer group
                 snap-start"
    >
      {/* Top row: rank + name + badge */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 leading-none select-none">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight group-hover:text-[#00d4ff] transition-colors">
            {player.full_name}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] text-muted-foreground font-medium">{player.team_abbr}</span>
            {player.next_opponent_abbr && (
              <>
                <span className="text-[10px] text-muted-foreground/40">·</span>
                <span className="text-[10px] text-muted-foreground/60">vs {player.next_opponent_abbr}</span>
              </>
            )}
          </div>
        </div>
        {badge && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none"
            style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* Stat row */}
      <div className="flex items-end justify-between">
        <div>
          <span className="text-[10px] text-muted-foreground">{STAT_LABELS[stat]} L5</span>
          <p className="text-lg font-bold text-white font-mono leading-none mt-0.5">
            {player.l5_avg.toFixed(1)}
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-muted-foreground">vs szn</span>
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <TrendingUp className="w-3 h-3 text-[#39ff14]" />
            <span className="text-sm font-bold font-mono text-[#39ff14] leading-none">
              +{diff.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function StripSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="glass-card rounded-xl p-3 min-w-[172px] max-w-[172px] shrink-0">
          <div className="flex items-start gap-2 mb-2">
            <Skeleton className="w-4 h-3 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="w-24 h-3.5" />
              <Skeleton className="w-16 h-2.5" />
            </div>
          </div>
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <Skeleton className="w-10 h-2.5" />
              <Skeleton className="w-12 h-5" />
            </div>
            <div className="space-y-1 flex flex-col items-end">
              <Skeleton className="w-10 h-2.5" />
              <Skeleton className="w-14 h-4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrendingPlayerStrip() {
  const [stat, setStat] = useState<TrendingStat>('pts');
  const [players, setPlayers] = useState<StripPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const fetchData = useCallback(async (s: TrendingStat) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/betting/players/trending-strip?stat=${s}&limit=15`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setPlayers(data.players ?? []);
    } catch (err) {
      console.error('Trending strip fetch error:', err);
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(stat);
  }, [stat, fetchData]);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      ro.disconnect();
    };
  }, [players, updateScrollButtons]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <section className="min-w-0">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[#ff6b35]" />
          <h2 className="text-lg font-semibold text-white">Trending Players</h2>
          <span className="text-[10px] px-2 py-0.5 bg-[#ff6b35]/15 text-[#ff6b35] rounded-full font-medium leading-none">
            L5 vs SZN
          </span>
        </div>

        {/* Scroll arrows (visible on hover of the section) */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className="w-6 h-6 rounded-md flex items-center justify-center
                       bg-white/5 hover:bg-white/10 disabled:opacity-0
                       transition-all duration-150"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-white/60" />
          </button>
          <button
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className="w-6 h-6 rounded-md flex items-center justify-center
                       bg-white/5 hover:bg-white/10 disabled:opacity-0
                       transition-all duration-150"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-3.5 h-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* Stat filter tabs */}
      <div className="flex items-center gap-1 mb-3">
        {STAT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStat(t.key)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all duration-150
              ${
                stat === t.key
                  ? 'bg-[#00d4ff]/15 text-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.15)]'
                  : 'text-muted-foreground hover:text-white hover:bg-white/5'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cards strip */}
      {loading ? (
        <StripSkeleton />
      ) : players.length === 0 ? (
        <div className="glass-card rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">No trending players found for {STAT_LABELS[stat]}</p>
        </div>
      ) : (
        <div className="relative">
          {/* Fade edges */}
          {canScrollLeft && (
            <div className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-linear-to-r from-background to-transparent" />
          )}
          {canScrollRight && (
            <div className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-linear-to-l from-background to-transparent" />
          )}

          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
          >
            {players.map((player, idx) => (
              <TrendingCard key={player.player_id} player={player} rank={idx + 1} stat={stat} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
