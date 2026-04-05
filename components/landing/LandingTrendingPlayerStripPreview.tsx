import Link from 'next/link';
import { Flame, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';

const STAT_TABS = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: '3pm', label: '3PM' },
  { key: 'pra', label: 'PRA' },
] as const;

type DemoPlayer = {
  name: string;
  team: string;
  opponent: string;
  l5: number;
  vsSzn: number;
  badge?: { label: string; color: string };
};

const DEMO_PLAYERS: DemoPlayer[] = [
  {
    name: 'Kyle Filipowski',
    team: 'UTA',
    opponent: 'OKC',
    l5: 22.6,
    vsSzn: 11.7,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Jrue Holiday',
    team: 'POR',
    opponent: 'DEN',
    l5: 20.8,
    vsSzn: 10.5,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Joel Embiid',
    team: 'PHI',
    opponent: 'BOS',
    l5: 28.4,
    vsSzn: 9.2,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Shai Gilgeous-Alexander',
    team: 'OKC',
    opponent: 'LAL',
    l5: 31.2,
    vsSzn: 8.1,
    badge: { label: 'PRA↑', color: '#bf5af2' },
  },
  {
    name: 'Giannis Antetokounmpo',
    team: 'MIL',
    opponent: 'CHA',
    l5: 30.5,
    vsSzn: 7.4,
  },
];

const SKELETON_TAIL_CARDS = 3;

function TrendingCardSkeleton() {
  return (
    <div
      className="glass-card rounded-xl p-3 min-w-[172px] max-w-[172px] shrink-0 border border-white/5"
      aria-hidden
    >
      <div className="flex items-start gap-2 mb-2">
        <Skeleton className="w-4 h-3 mt-0.5" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="w-24 h-3.5" />
          <Skeleton className="w-16 h-2.5" />
        </div>
        <Skeleton className="w-8 h-4 rounded-full shrink-0" />
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
  );
}

/**
 * Marketing preview: same shell as TrendingPlayerStrip; demo cards + skeleton tail (right).
 */
export function LandingTrendingPlayerStripPreview() {
  return (
    <section
      className="w-full max-w-6xl mx-auto mt-32 px-4 sm:px-6 min-w-0 slide-up"
      style={{ animationDelay: '580ms' }}
      aria-labelledby="landing-trending-strip-heading"
    >
      <LandingSectionHeader
        id="landing-trending-strip-heading"
        icon={Flame}
        accent="orange"
        title="Trending Players"
        description="L5 vs SZN — sample PTS rankings; switch stats in the live strip."
        href="/betting"
        linkLabel="View Full Terminal"
      />

      {/* Stat tabs — visual only (matches betting page) */}
      <div className="flex items-center gap-1 mb-3 flex-wrap" aria-hidden>
        {STAT_TABS.map((t) => (
          <span
            key={t.key}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${
              t.key === 'pts'
                ? 'bg-[#00d4ff]/15 text-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.15)]'
                : 'text-muted-foreground/80'
            }`}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <div
          className="absolute right-0 top-0 bottom-0 w-10 z-10 pointer-events-none bg-linear-to-l from-background via-background/80 to-transparent rounded-r-lg"
          aria-hidden
        />
        <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
          {DEMO_PLAYERS.map((player, idx) => (
            <Link
              key={player.name}
              href="/betting"
              className="glass-card rounded-xl p-3 min-w-[172px] max-w-[172px] shrink-0
                         border border-white/5 hover:border-[#00d4ff]/30
                         transition-all duration-200 cursor-pointer group
                         snap-start"
            >
              <div className="flex items-start gap-2 mb-2">
                <span className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 leading-none select-none">
                  #{idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate leading-tight group-hover:text-[#00d4ff] transition-colors">
                    {player.name}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">{player.team}</span>
                    <span className="text-[10px] text-muted-foreground/40">·</span>
                    <span className="text-[10px] text-muted-foreground/60">vs {player.opponent}</span>
                  </div>
                </div>
                {player.badge && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 leading-none"
                    style={{
                      backgroundColor: `${player.badge.color}20`,
                      color: player.badge.color,
                    }}
                  >
                    {player.badge.label}
                  </span>
                )}
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <span className="text-[10px] text-muted-foreground">PTS L5</span>
                  <p className="text-lg font-bold text-white font-mono leading-none mt-0.5">
                    {player.l5.toFixed(1)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground">vs szn</span>
                  <div className="flex items-center gap-1 justify-end mt-0.5">
                    <TrendingUp className="w-3 h-3 text-[#39ff14]" />
                    <span className="text-sm font-bold font-mono text-[#39ff14] leading-none">
                      +{player.vsSzn.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
          {Array.from({ length: SKELETON_TAIL_CARDS }, (_, i) => (
            <TrendingCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
