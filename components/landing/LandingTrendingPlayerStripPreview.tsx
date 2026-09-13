import Link from 'next/link';
import { Flame, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { LandingSection } from '@/components/landing/LandingSection';
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
  position: string;
  nbaId: number;
  l5: number;
  vsSzn: number;
  badge?: { label: string; color: string };
};

function nbaHeadshotUrl(nbaId: number) {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaId}.png`;
}

const DEMO_PLAYERS: DemoPlayer[] = [
  {
    name: 'Kyle Filipowski',
    team: 'UTA',
    position: 'C',
    nbaId: 1642271,
    l5: 22.6,
    vsSzn: 11.7,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Jrue Holiday',
    team: 'POR',
    position: 'PG',
    nbaId: 201950,
    l5: 20.8,
    vsSzn: 10.5,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Joel Embiid',
    team: 'PHI',
    position: 'C',
    nbaId: 203954,
    l5: 28.4,
    vsSzn: 9.2,
    badge: { label: 'HOT', color: '#ff6b35' },
  },
  {
    name: 'Shai Gilgeous-Alexander',
    team: 'OKC',
    position: 'PG',
    nbaId: 1628983,
    l5: 31.2,
    vsSzn: 8.1,
    badge: { label: 'PRA↑', color: '#bf5af2' },
  },
  {
    name: 'Giannis Antetokounmpo',
    team: 'MIL',
    position: 'PF',
    nbaId: 203507,
    l5: 30.5,
    vsSzn: 7.4,
  },
];

const SKELETON_TAIL_CARDS = 3;

const CARD_SHELL =
  'bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-3.5 w-max shrink-0';

function badgeClass(label: string): string {
  if (label === 'HOT') return 'bg-amber-50 text-amber-700 rounded-full font-semibold';
  return 'bg-[#56D6A3]/25 text-[#075B5C] rounded-full font-semibold';
}

function TrendingCardSkeleton() {
  return (
    <div className={CARD_SHELL} aria-hidden>
      <div className="flex gap-2.5">
        <Skeleton className="w-4 h-2.5 mt-1 shrink-0 bg-[#E8F0F1]" />
        <Skeleton className="w-[72px] h-[88px] rounded-2xl shrink-0 bg-[#E8F0F1]" />
        <div className="flex flex-col justify-between min-w-[160px] py-0.5">
          <div className="space-y-1.5">
            <Skeleton className="w-36 h-3.5 bg-[#E8F0F1]" />
            <Skeleton className="w-16 h-2.5 bg-[#E8F0F1]" />
          </div>
          <div className="flex items-end justify-between">
            <Skeleton className="w-12 h-8 bg-[#E8F0F1]" />
            <Skeleton className="w-14 h-8 bg-[#E8F0F1]" />
          </div>
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
    <LandingSection
      className="slide-up"
      style={{ animationDelay: '580ms' }}
      aria-labelledby="landing-trending-strip-heading"
    >
      <LandingSectionHeader
        id="landing-trending-strip-heading"
        icon={Flame}
        accent="orange"
        variant="watermark"
        title="Trending Players"
        description="L5 vs SZN — sample PTS rankings; switch stats in the live strip."
        href="/betting"
        linkLabel="View Full Terminal"
      />

      <div className="flex items-center gap-1 mb-3 flex-wrap" aria-hidden>
        {STAT_TABS.map((t) => (
          <span
            key={t.key}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg ${
              t.key === 'pts'
                ? 'bg-[#F8FBFA] border border-[#DCE9EA] text-[#063F46]'
                : 'text-[#72869A]'
            }`}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <div
          className="absolute right-0 top-0 bottom-0 w-10 z-10 pointer-events-none bg-linear-to-l from-[#f7f9f7] via-[#f7f9f7]/80 to-transparent rounded-r-lg"
          aria-hidden
        />
        <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
          {DEMO_PLAYERS.map((player, idx) => (
            <Link
              key={player.name}
              href="/betting"
              className={`${CARD_SHELL} hover:border-[#075B5C]/30 transition-colors cursor-pointer group snap-start`}
            >
              <div className="flex gap-2.5">
                <span className="text-[10px] font-mono text-[#72869A] leading-none pt-1 select-none shrink-0">
                  #{idx + 1}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={nbaHeadshotUrl(player.nbaId)}
                  alt=""
                  className="w-[72px] h-[88px] rounded-2xl object-cover object-[center_18%] bg-[#E8F0F1] shrink-0"
                />

                <div className="flex flex-col justify-between py-0.5 shrink-0">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <TeamLogo team={player.team} size="xs" decorative />
                      <p className="text-sm font-bold text-[#063F46] whitespace-nowrap leading-tight group-hover:text-[#075B5C] transition-colors">
                        {player.name}
                      </p>
                      {player.badge && (
                        <span className={`text-[10px] px-2 py-0.5 shrink-0 leading-none ${badgeClass(player.badge.label)}`}>
                          {player.badge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#72869A] font-medium mt-0.5 pl-6">
                      {player.team} · {player.position}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-8 mt-2 whitespace-nowrap">
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[#72869A] font-medium">PTS L5</span>
                      <p className="text-lg font-bold text-[#063F46] tabular-nums leading-none mt-0.5">
                        {player.l5.toFixed(1)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wide text-[#72869A] font-medium">vs SZN</span>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <TrendingUp className="w-3.5 h-3.5 text-[#20B95A]" />
                        <span className="text-sm font-bold tabular-nums text-[#20B95A] leading-none">
                          +{player.vsSzn.toFixed(1)}
                        </span>
                      </div>
                    </div>
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
    </LandingSection>
  );
}
