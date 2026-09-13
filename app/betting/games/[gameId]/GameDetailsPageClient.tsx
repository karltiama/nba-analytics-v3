'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MatchupPageLayout } from '@/components/betting/MatchupPageLayout';
import { BettingGameDetailsPageSkeleton } from './components/BettingGameDetailsPageSkeleton';
import { slateHref } from '@/lib/betting/research-journey';
import { shouldFetchLiveMatchupAnalysis } from '@/lib/betting/historical-final';

export function GameDetailsPageClient({ gameId }: { gameId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const detailsRes = await fetch(`/api/betting/games/${gameId}/details`);
        if (!detailsRes.ok) {
          const err = await detailsRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to load game details');
        }
        const details = await detailsRes.json();
        const isFinal = !shouldFetchLiveMatchupAnalysis(details.viewMode);
        if (!isFinal) {
          const [matchupRes, playerPropsRes] = await Promise.all([
            fetch(`/api/betting/games/${gameId}/matchup-analysis`).catch(() => null),
            fetch(`/api/betting/games/${gameId}/player-props`).catch(() => null),
          ]);
          if (matchupRes?.ok) {
            const matchup = await matchupRes.json();
            details.matchupAnalysis = matchup;
          }
          if (playerPropsRes?.ok) {
            const { playerProps } = await playerPropsRes.json();
            details.playerProps = playerProps ?? [];
          } else {
            details.playerProps = [];
          }
        } else {
          details.matchupAnalysis = null;
          details.playerProps = [];
        }
        if (!cancelled) setData(details);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Something went wrong');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [gameId]);

  if (loading) {
    return <BettingGameDetailsPageSkeleton />;
  }

  if (error || !data?.game) {
    return (
      <div className="min-h-screen bg-[#f7f9f7]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm border-l-4 border-l-[#c2410c] p-8 text-center">
            <h1 className="text-xl font-bold text-[#063f46] mb-2">Game not found</h1>
            <p className="text-[#4a6366] mb-4">{error || 'This game could not be loaded.'}</p>
            <Link href={slateHref()} className="text-[#075B5C] hover:underline text-sm">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <MatchupPageLayout data={data} />;
}
