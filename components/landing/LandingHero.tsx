import { ArrowRight, BarChart3, Trophy, Users, type LucideIcon } from 'lucide-react';
import { LandingTrackedLink } from '@/components/landing/LandingTrackedLink';
import { LandingHeroPlayerCard } from '@/components/landing/LandingHeroPlayerCard';

const HERO_PLAYER_SRC = '/landing/hero-tatum.png';
const HERO_PLAYER_ALT = 'Jayson Tatum';
const HERO_COURT_MOTIF_SRC = '/landing/hero-court-right.png';

const HERO_PILLARS: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: BarChart3, title: 'More than stats', detail: 'See the bigger picture' },
  { icon: Users, title: 'Built for fans', detail: 'Clear. Approachable. Deep.' },
  { icon: Trophy, title: 'Powered by context', detail: 'Because basketball is nuanced.' },
];

export function LandingHero() {
  return (
    <section className="relative w-full overflow-hidden bg-[#F9FBFC] border-b border-[#e6ecee]">
      {/* Court watermark: shrinks with the hero instead of staying at desktop scale. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HERO_COURT_MOTIF_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-0 z-0 h-[85%] w-auto max-w-none -translate-y-1/2 opacity-[0.07] select-none sm:h-[110%] sm:opacity-[0.09] md:h-[130%] lg:h-[170%] lg:opacity-[0.12]"
      />
      <div className="relative z-10 max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-28">
        <div className="relative sm:min-h-[34rem] md:min-h-[36rem] lg:min-h-[38rem]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={HERO_PLAYER_SRC}
            alt={HERO_PLAYER_ALT}
            className="pointer-events-none absolute bottom-0 right-0 z-0 hidden w-auto object-contain object-right-bottom select-none sm:block sm:max-md:h-[52%] sm:max-md:max-w-[44%] sm:[mask-image:linear-gradient(to_right,transparent,black_28%)] md:h-[30rem] md:max-w-[50%] md:-right-10 lg:right-0 lg:h-full lg:max-w-[48%] [mask-size:100%_100%]"
          />

          <div className="relative z-10 mx-auto flex w-full flex-col items-center text-center gap-4 pb-0 max-w-xl sm:mx-0 sm:items-start sm:text-left sm:gap-6 sm:pb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#d7e2de] bg-white">
              <span className="flex h-2 w-2 rounded-full bg-[#55ddb1]" />
              <span className="text-[10px] sm:text-[11px] font-bold text-[#063f46] uppercase tracking-wider">
                Offseason Improvements In Progress
              </span>
            </div>

            <div className="flex w-full flex-col items-center gap-2 sm:items-start sm:gap-3">
              <p className="text-[11px] sm:text-[13px] font-semibold uppercase tracking-[0.14em] sm:tracking-[0.18em] text-[#8aa0a3]">
                More than the trend.
              </p>
              <h1 className="w-full font-display text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[0.95] uppercase text-[#063f46]">
                See the game
                <span className="block">
                  in <span className="text-[#55ddb1]">context</span>
                </span>
              </h1>
            </div>

            <p className="w-full text-base sm:text-lg md:text-xl text-[#4a6366] sm:max-w-[22rem] md:max-w-md lg:max-w-lg">
              Research player props, parlays, players, and games. Stats tell what happened; context helps explain why it matters.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1 sm:justify-start sm:pt-2">
              <LandingTrackedLink
                href="/betting?onboard=1"
                location="hero"
                action="explore_court_context"
                className="group inline-flex h-12 w-auto items-center justify-center gap-2 rounded-lg bg-[#063f46] px-5 sm:px-6 text-white font-semibold transition-colors hover:bg-[#0a525c]"
              >
                Explore Court Context
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </LandingTrackedLink>
            </div>
          </div>

          <ul className="relative z-10 mt-4 mb-4 grid w-full max-w-xl mx-auto grid-cols-3 gap-2 sm:mt-10 sm:mb-10 sm:flex sm:max-w-none sm:mx-0 sm:flex-row sm:flex-wrap sm:items-start sm:gap-5 sm:gap-x-8 lg:gap-x-10">
            {HERO_PILLARS.map(({ icon: Icon, title, detail }) => (
              <li key={title} className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:max-w-[240px] sm:flex-row sm:items-start sm:gap-3 sm:text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#55ddb1]/30 sm:h-11 sm:w-11">
                  <Icon className="h-4 w-4 text-[#075B5C] sm:h-5 sm:w-5" strokeWidth={2} />
                </span>
                <div className="min-w-0 sm:pt-0.5">
                  <p className="text-xs font-bold text-[#063f46] leading-tight sm:text-sm">{title}</p>
                  <p className="hidden text-[13px] text-[#4a6366] leading-snug mt-0.5 sm:block">{detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="relative z-20 mx-auto w-full max-w-xl pb-6 md:absolute md:bottom-8 md:right-6 md:mx-0 md:w-[280px] md:max-w-[280px] md:pb-0 lg:top-1/2 lg:bottom-auto lg:right-4 lg:-translate-y-1/2 lg:w-[300px] lg:max-w-none">
            <LandingHeroPlayerCard />
          </div>
        </div>
      </div>
    </section>
  );
}
