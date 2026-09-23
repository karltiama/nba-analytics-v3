'use client';

import { useSearchParams } from 'next/navigation';
import { ParlayWorkspaceClient } from './ParlayWorkspaceClient';
import { ParlayWorkspacePreviewClient } from './ParlayWorkspacePreviewClient';
import { isWorkspaceHistoricalPreview } from '@/lib/parlay/preview-fixture';
import { parsePreviewScenario } from '@/lib/preview/scenario';

export function ParlayWorkspaceEntry() {
  const searchParams = useSearchParams();
  const scenario = parsePreviewScenario(searchParams.get('preview'));
  if (scenario) {
    return <ParlayWorkspacePreviewClient scenario={scenario} />;
  }
  if (isWorkspaceHistoricalPreview(searchParams.get('preview'))) {
    return <ParlayWorkspacePreviewClient />;
  }
  return <ParlayWorkspaceClient />;
}
