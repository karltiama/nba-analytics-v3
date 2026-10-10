import { notFound } from 'next/navigation';
import { BettingAppShell } from '@/components/betting/BettingAppShell';

export const dynamic = 'force-dynamic';

/** Local fixture preview. Production requests 404 so mock games are never served as live. */
export default async function ScoreboardPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const { ScoreboardPreview } = await import('@/components/scoreboard/ScoreboardPreview');
  return (
    <BettingAppShell>
      <main className="mx-auto max-w-[1800px] px-4 py-8 sm:px-6 lg:px-8">
        <ScoreboardPreview />
      </main>
    </BettingAppShell>
  );
}
