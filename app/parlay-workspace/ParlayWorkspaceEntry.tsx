'use client';

import { useSearchParams } from 'next/navigation';
import { ParlayWorkspaceClient } from './ParlayWorkspaceClient';
import { ParlayWorkspacePreviewClient } from './ParlayWorkspacePreviewClient';
import { isWorkspaceHistoricalPreview } from '@/lib/parlay/preview-fixture';

export function ParlayWorkspaceEntry() {
  const searchParams = useSearchParams();
  if (isWorkspaceHistoricalPreview(searchParams.get('preview'))) {
    return <ParlayWorkspacePreviewClient />;
  }
  return <ParlayWorkspaceClient />;
}
