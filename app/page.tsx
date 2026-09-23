import { Activity } from 'lucide-react';
import { FeaturedGames } from '@/components/landing/FeaturedGames';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingParlayXrayPreview } from '@/components/landing/LandingParlayXrayPreview';
import { LandingPropsTablePreview } from '@/components/landing/LandingPropsTablePreview';
import { LandingTrendingPlayerStripPreview } from '@/components/landing/LandingTrendingPlayerStripPreview';
import { MarketingHeader } from '@/components/landing/MarketingHeader';
import { WowyImpactSection } from '@/components/landing/WowyImpactSection';
import {
  landingPreviewGames,
  landingPreviewPlayers,
  landingPreviewPropRows,
  landingPreviewWowy,
  landingPreviewXray,
} from '@/lib/preview/landing-data';
import { parsePreviewScenario } from '@/lib/preview/scenario';

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ preview?: string | string[] }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const rawPreview = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  const scenario = parsePreviewScenario(rawPreview);
  const previewGames = scenario ? landingPreviewGames(scenario) : undefined;
  const previewPlayers = scenario ? landingPreviewPlayers(scenario) : undefined;
  const previewRows = scenario ? landingPreviewPropRows(scenario) : undefined;
  const previewWowy = scenario ? landingPreviewWowy(scenario) : undefined;
  const previewXray = scenario ? landingPreviewXray(scenario) : undefined;

  return (
    <div className="min-h-screen bg-[#f7f9f7] text-[#063f46] relative overflow-hidden">
      <MarketingHeader />

      <main className="relative z-10">
        <LandingHero />

        <div className="flex flex-col gap-12 md:gap-20 lg:gap-32 pt-12 md:pt-20 lg:pt-32 pb-12 md:pb-16 lg:pb-20 px-4 sm:px-6 lg:px-8 max-w-[1280px] mx-auto">
        {/* Featured Games / Live Data */}
        <FeaturedGames
          {...(previewGames ? { games: previewGames } : {})}
          {...(scenario === 'error'
            ? { description: 'This preview scenario could not load sample matchups.' }
            : {})}
        />

        <LandingPropsTablePreview {...(previewRows ? { rows: previewRows } : {})} />

        <LandingTrendingPlayerStripPreview {...(previewPlayers ? { players: previewPlayers } : {})} />

        <WowyImpactSection {...(previewWowy ? { scenarios: previewWowy } : {})} />

        <LandingParlayXrayPreview {...(previewXray ? { demo: previewXray } : {})} />
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
