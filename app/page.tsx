import Link from 'next/link';
import { Activity } from 'lucide-react';
import { FeaturedGames } from '@/components/landing/FeaturedGames';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingPropsTablePreview } from '@/components/landing/LandingPropsTablePreview';
import { LandingTrendingPlayerStripPreview } from '@/components/landing/LandingTrendingPlayerStripPreview';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f7f9f7] text-[#063f46] relative overflow-hidden">
      <header className="absolute top-0 w-full z-50">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex justify-between items-center gap-3">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0" aria-label="Court Context home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/court-context-logo.png"
            alt=""
            className="h-10 sm:h-12 lg:h-14 w-auto select-none"
          />
          <span className="font-bold text-xl sm:text-3xl lg:text-5xl tracking-tight text-[#063f46] truncate">
            Court Context
          </span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-6 shrink-0">
          <Link href="/login" className="text-sm font-medium text-[#4a6366] hover:text-[#063f46] transition-colors">
            Sign In
          </Link>
          <Link href="/signup" className="text-sm font-semibold bg-[#55ddb1] hover:bg-[#3dcc9f] text-[#063f46] rounded-lg px-3 sm:px-5 py-2 transition-colors">
            Get Started
          </Link>
        </div>
        </div>
      </header>

      <main className="relative z-10">
        <LandingHero />

        <div className="flex flex-col gap-12 md:gap-20 lg:gap-32 pt-12 md:pt-20 lg:pt-32 pb-12 md:pb-16 lg:pb-20 px-4 sm:px-6 lg:px-8 max-w-[1280px] mx-auto">
        {/* Featured Games / Live Data */}
        <FeaturedGames />

        <LandingPropsTablePreview />

        <LandingTrendingPlayerStripPreview />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-10 border-t border-[#d7e2de] py-10 bg-[#063f46]">
        <div className="max-w-[1280px] mx-auto px-6 text-center text-sm text-white/70 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span className="font-bold tracking-tight text-white">NBAEdge</span>
          </div>
          <p>© {new Date().getFullYear()} NBA Analytics Edge. For informational purposes only.</p>
        </div>
      </footer>
    </div>
  );
}
