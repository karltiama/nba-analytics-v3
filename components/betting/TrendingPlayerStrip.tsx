'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { TrendingUp, Flame, ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { TeamLogo } from '@/components/nba/TeamLogo';

type TrendingStat = 'pts' | 'reb' | 'ast' | '3pm' | 'pra';

interface StripPlayer {
  player_id: string;
  full_name: string;
  team_abbr: string;
  next_opponent_abbr: string | null;
  nba_player_id?: string | null;
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

function nbaHeadshotUrl(nbaId: string) {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaId}.png`;
}

function playerInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

function PlayerHeadshot({ nbaId, name }: { nbaId: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const shell = 'relative w-[72px] h-[88px] rounded-2xl overflow-hidden bg-[#E8F0F1] shrink-0';
  if (!nbaId || failed) {
    return (
      <div className={`${shell} flex items-center justify-center`} aria-hidden>
        <span className="text-sm font-bold text-cc-secondary">{playerInitials(name)}</span>
      </div>
    );
  }
  return (
    <div className={shell}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nbaHeadshotUrl(nbaId)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[center_22%]"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function getBadge(player: StripPlayer, stat: TrendingStat): { label: string; color: string } | null {
  const score = player.trend_score;
  const t = player.trends;

  // Season-wide L5 vs season average — not a tonight-slate "HOT" claim.
  if (player.season_avg > 0 && score / player.season_avg >= 0.20) {
    return { label: 'L5 trend', color: '#ff6b35' };
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
      className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-3.5 w-max shrink-0
                 hover:border-[#075B5C]/30
                 transition-all duration-200 cursor-pointer group
                 snap-start"
    >
      <div className="flex gap-2.5">
        <span className="type-metadata pt-1 font-mono leading-none select-none shrink-0">
          #{rank}
        </span>
        <PlayerHeadshot nbaId={player.nba_player_id ?? null} name={player.full_name} />
        <div className="flex flex-col justify-between py-0.5 shrink-0 min-w-[160px]">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="type-card-data whitespace-nowrap text-[#063f46] group-hover:text-[#075B5C] transition-colors">
                {player.full_name}
              </p>
              {badge && (
                <span
                  className="type-badge shrink-0 rounded-full px-1.5 py-0.5 leading-none"
                  style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                >
                  {badge.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <TeamLogo team={player.team_abbr} size="xs" decorative />
              <span className="type-secondary">{player.team_abbr}</span>
              {player.next_opponent_abbr && (
                <>
                  <span className="text-[#DCE9EA]" aria-hidden>·</span>
                  <span className="type-metadata">vs {player.next_opponent_abbr}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-end justify-between gap-8 mt-2 whitespace-nowrap">
            <div>
              <span className="type-metadata">{STAT_LABELS[stat]} L5</span>
              <p className="text-lg font-bold text-[#063f46] font-mono leading-none mt-0.5">
                {player.l5_avg.toFixed(1)}
              </p>
            </div>
            <div className="text-right">
              <span className="type-metadata">vs szn</span>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <TrendingUp className="w-3 h-3 text-[#20B95A]" />
                <span className="type-card-data font-mono leading-none text-[#20B95A]">
                  +{diff.toFixed(1)}
                </span>
              </div>
            </div>
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
        <div key={i} className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-3.5 w-max shrink-0">
          <div className="flex gap-2.5">
            <Skeleton className="w-4 h-2.5 mt-1 shrink-0" />
            <Skeleton className="w-[72px] h-[88px] rounded-2xl shrink-0" />
            <div className="flex flex-col justify-between min-w-[160px] py-0.5">
              <div className="space-y-1.5">
                <Skeleton className="w-36 h-3.5" />
                <Skeleton className="w-16 h-2.5" />
              </div>
              <div className="flex items-end justify-between">
                <Skeleton className="w-12 h-8" />
                <Skeleton className="w-14 h-8" />
              </div>
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
      const res = await fetch(`/api/betting/players/trending-strip?stat=${s}&limit=15`, {
        credentials: 'include',
        cache: 'no-store',
      });
      // 401 is expected when the session is missing; parent page shows UnauthorizedPanel.
      if (!res.ok) {
        setPlayers([]);
        return;
      }
      const data = await res.json();
      setPlayers(data.players ?? []);
    } catch {
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
          <Flame className="w-4 h-4 text-amber-600" />
          <h2 className="type-section-heading text-[#063f46]">Recent form</h2>
          <span className="type-badge rounded-full bg-amber-50 px-2 py-0.5 leading-none text-amber-700">
            L5 vs SZN
          </span>
        </div>

        {/* Scroll arrows (visible on hover of the section) */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className="w-6 h-6 rounded-md flex items-center justify-center
                       bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] disabled:opacity-0
                       transition-all duration-150"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-[#4a6366]" />
          </button>
          <button
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className="w-6 h-6 rounded-md flex items-center justify-center
                       bg-white border border-[#DCE9EA] hover:bg-[#f7f9f7] disabled:opacity-0
                       transition-all duration-150"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-3.5 h-3.5 text-[#4a6366]" />
          </button>
        </div>
      </div>

      {/* Stat filter tabs */}
      <div className="mb-3 flex items-center gap-1 overflow-x-auto">
        {STAT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStat(t.key)}
            className={`type-interactive shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 transition-all duration-150
              ${
                stat === t.key
                  ? 'border border-[#DCE9EA] bg-[#F8FBFA] text-[#063F46]'
                  : 'text-cc-secondary hover:bg-[#f7f9f7] hover:text-[#063f46]'
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
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-6 text-center">
          <p className="type-body text-cc-secondary">No trending players found for {STAT_LABELS[stat]}</p>
        </div>
      ) : (
        <div className="relative">
          {/* Fade edges */}
          {canScrollLeft && (
            <div className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-linear-to-r from-[#f7f9f7] to-transparent" />
          )}
          {canScrollRight && (
            <div className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-linear-to-l from-[#f7f9f7] to-transparent" />
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
