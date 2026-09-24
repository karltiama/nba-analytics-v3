import Link from 'next/link';
import { ArrowRight, BarChart3, Trophy, Users } from 'lucide-react';
import { MarketingHeader } from '@/components/landing/MarketingHeader';

const COURT_MOTIF_SRC = '/landing/hero-court-right.png';

const PILLARS = [
  { icon: BarChart3, title: 'Same great data', detail: 'Just a different route.' },
  { icon: Users, title: 'Back to what you love', detail: 'Games, props, and insights.' },
  { icon: Trophy, title: 'Still in the game', detail: 'Because basketball never stops.' },
] as const;

function CourtMotif() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={COURT_MOTIF_SRC}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-0 z-0 h-[85%] w-auto max-w-none -translate-y-1/2 opacity-[0.10] select-none sm:h-[110%] sm:opacity-[0.12] md:h-[140%] lg:h-[180%] lg:opacity-[0.16]"
    />
  );
}

export function MissedShot404({ chrome }: { chrome: 'marketing' | 'app' }) {
  const body = (
    <section className="relative overflow-hidden">
      {chrome === 'app' ? <CourtMotif /> : null}

      <div className="relative z-10 max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl min-h-[22rem] sm:min-h-[28rem] lg:min-h-[32rem] flex flex-col justify-center">
          <div className="inline-flex w-fit items-center gap-2 px-3 py-1 rounded-full border border-[#d7e2de] bg-white">
            <span className="flex h-2 w-2 rounded-full bg-[#55ddb1]" />
            <span className="text-[10px] sm:text-[11px] font-bold text-[#063f46] uppercase tracking-wider">
              404 Error
            </span>
          </div>

          <h1 className="mt-5 text-[4.5rem] sm:text-8xl lg:text-[7.5rem] font-extrabold tracking-tighter leading-[0.85] text-[#063f46]">
            404
          </h1>
          <p className="mt-2 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[0.95] text-[#063f46]">
            This page
            <span className="block text-[#55ddb1]">missed the shot.</span>
          </p>
          <p className="mt-5 max-w-md text-base sm:text-lg text-[#4a6366]">
            The page you&apos;re looking for may have moved, expired, or never made it to the basket.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#063f46] px-5 sm:px-6 text-white font-semibold transition-colors hover:bg-[#0a525c]"
            >
              Go Home
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-[#d7e2de] bg-white px-5 sm:px-6 text-[#063f46] font-semibold transition-colors hover:border-[#b7c9c4]"
            >
              Explore Games
            </Link>
          </div>
        </div>

        <ul className="relative z-10 mt-10 mb-4 grid w-full grid-cols-1 gap-4 sm:mt-14 sm:mb-8 sm:grid-cols-3 sm:gap-8">
          {PILLARS.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#55ddb1]/30">
                <Icon className="h-5 w-5 text-[#075B5C]" strokeWidth={2} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-bold text-[#063f46] leading-tight">{title}</p>
                <p className="text-[13px] text-[#4a6366] leading-snug mt-0.5">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  if (chrome === 'app') {
    return <div className="relative overflow-hidden pt-8 pb-12">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-[#F9FBFC] text-[#063f46] relative overflow-hidden flex flex-col">
      <CourtMotif />
      <MarketingHeader />
      <main className="relative z-10 flex-1 pt-24 sm:pt-28 pb-10">{body}</main>
      <footer className="relative z-10 mt-auto bg-[#063f46] text-white">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 min-w-0" aria-label="Court Context home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/court-context-logo.png" alt="" className="h-8 w-auto brightness-0 invert" />
            <span className="font-bold tracking-tight">Court Context</span>
          </Link>
          <p className="text-sm text-white/70">More than the trend.</p>
          <p className="text-sm text-white/60">© {new Date().getFullYear()} Court Context. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
