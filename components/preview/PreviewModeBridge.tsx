'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { installPreviewFetch } from '@/lib/preview/install-fetch';
import { parsePreviewScenario, previewScenarioLabel, type PreviewScenario } from '@/lib/preview/scenario';

export function PreviewScenarioBadge({ scenario }: { scenario: PreviewScenario | null }) {
  if (!scenario) return null;
  return (
    <div
      data-preview-scenario={scenario}
      className="pointer-events-none fixed right-3 top-[max(4.75rem,env(safe-area-inset-top))] z-30 rounded-full bg-[#063f46]/80 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white"
    >
      PREVIEW · {previewScenarioLabel(scenario)}
    </div>
  );
}

export function PreviewModeBridge() {
  const searchParams = useSearchParams();
  const scenario = parsePreviewScenario(searchParams.get('preview'));

  useEffect(() => {
    if (!scenario) return;
    return installPreviewFetch();
  }, [scenario]);

  return <PreviewScenarioBadge scenario={scenario} />;
}
