import type { ReactNode } from 'react';
import Link from 'next/link';
import { BarChart3, Trophy, Users, type LucideIcon } from 'lucide-react';

const HERO_PLAYER_SRC = '/landing/hero-tatum.png';
const FULL_COURT_SRC = '/landing/full-court.png';

const PILLARS: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: BarChart3, title: 'Deeper insights', detail: 'More than just stats.' },
  { icon: Users, title: 'Built for fans', detail: 'Clear. Approachable. Deep.' },
  { icon: Trophy, title: 'Powered by context', detail: 'Because basketball is nuanced.' },
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 min-w-0" aria-label="Court Context home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/court-context-logo.png"
        alt=""
        className={compact ? 'h-9 w-auto select-none' : 'h-11 w-auto select-none'}
      />
      <span className="min-w-0">
        <span
          className={`block font-bold tracking-tight leading-none ${compact ? 'text-lg text-[#063f46]' : 'text-xl text-white'}`}
        >
          Court Context
        </span>
        {!compact ? (
          <span className="block text-[11px] text-white/70 mt-1">More than numbers.</span>
        ) : null}
      </span>
    </Link>
  );
}

function AuthBrandPanel() {
  return (
    <aside className="relative hidden lg:flex min-h-full flex-col justify-between overflow-hidden bg-[#063f46] p-10 xl:p-12">
      <div className="absolute inset-0 bg-gradient-to-br from-[#052c31] via-[#063f46] to-[#0a525c]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={FULL_COURT_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-auto w-[120vh] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 object-contain opacity-15 select-none"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HERO_PLAYER_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 -right-20 z-1 h-full w-auto max-w-[70%] object-contain object-bottom-right select-none mask-[linear-gradient(to_right,transparent,black_28%)]"
      />
      <div className="absolute inset-0 z-2 bg-linear-to-r from-[#021618]/85 via-[#021618]/30 to-transparent" />
      <div className="absolute inset-0 z-2 bg-linear-to-t from-[#021618]/80 via-transparent to-[#021618]/30" />

      <div className="relative z-10">
        <BrandMark />
      </div>

      <div className="relative z-10 max-w-80 space-y-6 pb-4">
        <div>
          <h2 className="text-5xl xl:text-6xl font-extrabold tracking-tight leading-[0.95] text-white">
            See the
            <span className="block">
              game in <span className="text-[#55ddb1]">context.</span>
            </span>
          </h2>
          <p className="mt-4 text-sm xl:text-base text-white/75 leading-relaxed">
            Player props, matchups, injuries, trends, and advanced analytics — all in one place.
          </p>
        </div>

        <ul className="space-y-3.5">
          {PILLARS.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#55ddb1]/40 bg-[#55ddb1]/15">
                <Icon className="h-4 w-4 text-[#55ddb1]" strokeWidth={2} />
              </span>
              <span>
                <p className="text-sm font-semibold text-white leading-tight">{title}</p>
                <p className="text-xs text-white/65 mt-0.5">{detail}</p>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 max-w-72 drop-shadow-sm">
        <div className="h-0.5 w-10 bg-[#55ddb1] mb-4" />
        <p className="text-lg italic text-white/90 leading-snug">
          “Context turns numbers into stories.”
        </p>
        <p className="mt-3 text-[11px] font-semibold tracking-[0.18em] uppercase text-white/55">
          — Court Context
        </p>
      </div>
    </aside>
  );
}

export function AuthSplitLayout({
  topRight,
  children,
}: {
  topRight: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#e8f0ee] p-3 sm:p-4 lg:p-5 text-[#063f46]">
      <div className="grid min-h-[calc(100vh-1.5rem)] sm:min-h-[calc(100vh-2rem)] lg:min-h-[calc(100vh-2.5rem)] lg:grid-cols-2 overflow-hidden rounded-3xl border border-[#DCE9EA] bg-[#f7f9f7] shadow-sm">
        <AuthBrandPanel />

        <div className="relative flex flex-col">
          <div className="relative z-10 flex items-center justify-between gap-3 px-5 pt-5 sm:px-8 lg:justify-end lg:px-10 lg:pt-8">
            <div className="lg:hidden">
              <BrandMark compact />
            </div>
            <p className="text-sm text-[#4a6366] text-right">{topRight}</p>
          </div>

          <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-8 sm:px-10 lg:px-16">
            <div className="mx-auto w-full max-w-md">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthInsightCard() {
  return (
    <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[#DCE9EA] bg-white/70 px-4 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#55ddb1]/25">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#075B5C]" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 3c2.2 2.4 3.4 5.5 3.4 9s-1.2 6.6-3.4 9c-2.2-2.4-3.4-5.5-3.4-9s1.2-6.6 3.4-9Z" stroke="currentColor" strokeWidth="1.75" />
          <path d="M3.5 9.5h17M3.5 14.5h17" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      </span>
      <div>
        <p className="text-sm font-semibold text-[#063f46]">Same account, more insights</p>
        <p className="text-xs text-[#4a6366] mt-0.5 leading-relaxed">
          Your data, saved players, and preferences sync across all your devices.
        </p>
      </div>
    </div>
  );
}
