import { isXrayExtractionLive } from '@/lib/parlay-xray/extraction/config';
import { ParlayXrayClient } from './ParlayXrayClient';

// Read the kill switch per request, not at build time.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Parlay XRay · Court Context',
  description:
    'Import an existing slip when screenshot reading is available. Confirm is the trust boundary. Analysis happens in Workspace — not on this page.',
};

export default function ParlayXrayPage() {
  return <ParlayXrayClient extractionAvailable={isXrayExtractionLive()} />;
}
