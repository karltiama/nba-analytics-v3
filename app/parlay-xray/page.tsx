import { ParlayXrayClient } from './ParlayXrayClient';

export const metadata = {
  title: 'Parlay XRay · Court Context',
  description:
    'Import an existing slip when screenshot reading is available. Confirm is the trust boundary. Analysis happens in Workspace — not on this page.',
};

export default function ParlayXrayPage() {
  return <ParlayXrayClient />;
}
