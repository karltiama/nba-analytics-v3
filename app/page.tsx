import { Activity } from 'lucide-react';
import { FeaturedGames } from '@/components/landing/FeaturedGames';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingParlayXrayPreview } from '@/components/landing/LandingParlayXrayPreview';
import { LandingPropsTablePreview } from '@/components/landing/LandingPropsTablePreview';
import { LandingTrendingPlayerStripPreview } from '@/components/landing/LandingTrendingPlayerStripPreview';
import { MarketingHeader } from '@/components/landing/MarketingHeader';
import { WowyImpactSection } from '@/components/landing/WowyImpactSection';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f7f9f7] text-[#063f46] relative overflow-hidden">
      <MarketingHeader />

      <main className="relative z-10">
        <LandingHero />

        <div className="flex flex-col gap-12 md:gap-20 lg:gap-32 pt-12 md:pt-20 lg:pt-32 pb-12 md:pb-16 lg:pb-20 px-4 sm:px-6 lg:px-8 max-w-[1280px] mx-auto">
        {/* Featured Games / Live Data */}
        <FeaturedGames />

        <LandingPropsTablePreview />

        <LandingTrendingPlayerStripPreview />

        <WowyImpactSection />

        <LandingParlayXrayPreview />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-10 border-t border-[#d7e2de] py-10 bg-[#063f46]">
        <div className="max-w-[1280px] mx-auto px-6 text-center text-sm text-white/70 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span className="font-bold tracking-tight text-white">Court Context</span>
          </div>
          <p>© {new Date().getFullYear()} Court Context. Research only — not betting advice.</p>
        </div>
      </footer>
    </div>
  );
}
