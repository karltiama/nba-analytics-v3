import { ParlayXrayClient } from './ParlayXrayClient';

export const metadata = {
  title: 'Parlay XRay · Court Context',
  description:
    'Upload a parlay screenshot and review the context, risk, and uncertainty behind each leg. Not a win prediction.',
};

export default function ParlayXrayPage() {
  return <ParlayXrayClient />;
}
