import { Suspense } from 'react';
import { ParlayWorkspaceEntry } from './ParlayWorkspaceEntry';

export const metadata = {
  title: 'Parlay Workspace · Court Context',
  description: 'Review selected props together with Court Context analysis in Parlay Workspace.',
};

export default function ParlayWorkspacePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-4 py-12 text-sm text-[#4a6366]">Loading workspace…</main>}>
      <ParlayWorkspaceEntry />
    </Suspense>
  );
}
