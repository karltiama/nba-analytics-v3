'use client';

import { useMemo, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { LandingSection } from '@/components/landing/LandingSection';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';
import { ExtractedLegsPanel } from '@/components/parlay-xray/ExtractedLegsPanel';
import { XrayAnalysisPanel } from '@/components/parlay-xray/XrayAnalysisPanel';
import {
  getLandingParlayXrayDemo,
  type LandingParlayXrayDemo,
} from '@/lib/landing/parlay-xray-demo';

/**
 * Marketing preview: same shell as /parlay-xray design preview (upload + legs + analysis).
 * Static fixture only — no extract/API calls.
 */
export function LandingParlayXrayPreview({
  demo: demoOverride,
}: {
  demo?: LandingParlayXrayDemo;
} = {}) {
  const demo = useMemo(() => demoOverride ?? getLandingParlayXrayDemo(), [demoOverride]);
  const [editing, setEditing] = useState(false);

  return (
    <LandingSection
      className="slide-up"
      style={{ animationDelay: '640ms' }}
      aria-labelledby="landing-parlay-xray-heading"
    >
      <LandingSectionHeader
        id="landing-parlay-xray-heading"
        icon={ScanSearch}
        accent="lime"
        variant="watermark"
        title="Parlay XRay"
        description="Sample slip layout — illustration only. Screenshot reading is not available yet."
        href="/betting/props-explorer"
        linkLabel="Open Props Explorer"
        action="explore_props"
      />

      <p
        className="rounded-xl border border-amber-200 bg-[#fff8ee] px-4 py-3 text-sm text-[#9a3412] mb-5"
        role="status"
      >
        Design preview — fictional layout data. This is not a read of an uploaded screenshot.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <header className="lg:col-span-3 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cc-secondary">
            Parlay XRay
          </p>
          <h3 className="text-4xl sm:text-5xl font-black tracking-tight text-[#063f46] leading-[0.95]">
            Screenshot import is closed.
          </h3>
          <p className="text-sm sm:text-base text-[#4a6366] max-w-md">
            Research a prop in Props Explorer, then review the parlay in Workspace.
          </p>
        </header>

        <section className="lg:col-span-5 bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
          <h3 className="text-base font-bold text-[#063f46]">Screenshot reading is not available yet.</h3>
          <p className="text-sm text-[#4a6366] mt-1">
            This layout is an illustration. It does not read a screenshot or open a sportsbook.
          </p>
        </section>

        <div className="lg:col-span-4">
          <ExtractedLegsPanel
            legs={demo.parlay.legs}
            editing={editing}
            extractionStatusLabel={demo.extractionStatusLabel}
            canConfirm
            confirmed
            confirmLabel="Legs confirmed"
            confirmHint="Confirm is the boundary between what XRay read and Parlay Workspace. This landing preview does not hand off a live slip."
            onToggleEditing={() => setEditing((v) => !v)}
            onEditLeg={() => undefined}
            onAcceptLeg={() => undefined}
            onConfirm={() => undefined}
          />
        </div>
      </div>

      <div className="mt-5">
        <XrayAnalysisPanel
          analysis={demo.analysis}
          legs={demo.parlay.legs}
          combinedOdds={demo.combinedOdds}
          structural={demo.structural}
          analysisStageCopy={demo.analysisStageCopy}
          designPreview
          showExplorerPlacement
        />
      </div>
    </LandingSection>
  );
}
