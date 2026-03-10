'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MatchupPageLayout } from '@/components/betting/MatchupPageLayout';

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
        const [detailsRes, matchupRes, playerPropsRes] = await Promise.all([
          fetch(`/api/betting/games/${gameId}/details`),
          fetch(`/api/betting/games/${gameId}/matchup-analysis`).catch(() => null),
          fetch(`/api/betting/games/${gameId}/player-props`).catch(() => null),
        ]);
        if (!detailsRes.ok) {
          const err = await detailsRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to load game details');
        }
        const details = await detailsRes.json();
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
    return (
      <div className="min-h-screen bg-background gradient-mesh flex items-center justify-center">
        <div className="glass-card rounded-2xl p-8">
          <p className="text-white">Loading game details...</p>
        </div>
      </div>
    );
  }

  if (error || !data?.game) {
    return (
      <div className="min-h-screen bg-background gradient-mesh">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="glass-card rounded-xl border-l-4 border-l-[#ff4757] p-8 text-center">
            <h1 className="text-xl font-bold text-white mb-2">Game not found</h1>
            <p className="text-muted-foreground mb-4">{error || 'This game could not be loaded.'}</p>
            <Link href="/betting" className="text-[#00d4ff] hover:underline text-sm">
              ← Back to Betting
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <MatchupPageLayout data={data} />;
}
