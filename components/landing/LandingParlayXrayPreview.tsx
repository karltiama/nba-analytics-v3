'use client';

import { useMemo, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { LandingSection } from '@/components/landing/LandingSection';
import { LandingSectionHeader } from '@/components/landing/LandingSectionHeader';
import { ExtractedLegsPanel } from '@/components/parlay-xray/ExtractedLegsPanel';
import { UploadDropzone } from '@/components/parlay-xray/UploadDropzone';
import { XrayAnalysisPanel } from '@/components/parlay-xray/XrayAnalysisPanel';
import {
  getLandingParlayXrayDemo,
  LANDING_XRAY_STAGE_STEPS,
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
        description="Sample slip layout — illustration only, not a live screenshot read."
        href="/parlay-xray"
        linkLabel="Open Parlay XRay"
        action="open_parlay_xray"
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
            Upload your slip.
          </h3>
          <p className="text-sm sm:text-base text-[#4a6366] max-w-md">
            Verify what XRay read, then review the parlay with Court Context. XRay imports a
            screenshot — it is not the finished analysis.
          </p>
          <p className="text-xs font-semibold text-[#075B5C]">
            Upload → Review → Confirm → Workspace
          </p>
        </header>

        <section className="lg:col-span-5 bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
          <h3 className="text-base font-bold text-[#063f46]">Upload your parlay</h3>
          <p className="text-sm text-[#4a6366] mt-1 mb-4">
            Drag and drop a screenshot of your bet slip, or choose a file. The image stays on this
            device in this step.
          </p>
          <div className="pointer-events-none select-none">
            <UploadDropzone
              screenshot={demo.parlay.uploadedImage}
              error={null}
              statusHint="Illustration only — not a live slip"
              thumbnailHint="Illustration"
              onSelected={() => undefined}
              onRejected={() => undefined}
            />
          </div>
          <ol className="mt-5 space-y-2 text-xs text-[#4a6366]">
            {LANDING_XRAY_STAGE_STEPS.map((step) => (
              <li key={step.label}>
                <span className="font-semibold text-[#063f46]">{step.label}</span> {step.detail}
              </li>
            ))}
          </ol>
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
