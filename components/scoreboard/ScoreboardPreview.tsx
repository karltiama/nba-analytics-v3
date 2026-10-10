'use client';

import { GameCard } from '@/components/betting/GameCard';
import { loadScoreboardFixture } from '@/lib/scoreboard/fixtures';
import { mergeTodaysGames } from '@/lib/scoreboard/slate-merge';

const FIXTURE_BANNER = 'Fixture data for local preview. This is not a live scoreboard.';

/** Dev-only preview of Today's Games cards. Does not call /api/scoreboard. */
export function ScoreboardPreview() {
  const games = mergeTodaysGames(loadScoreboardFixture());
  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page-title text-[#063f46]">Today&apos;s Games preview</h1>
        <p className="type-body mt-2 max-w-3xl text-cc-secondary">
          The same game cards as the dashboard. Preseason, regular season, play-in, and playoff labels are
          presentation only. This page does not acquire games or call the provider.
        </p>
      </div>
      <p className="type-secondary rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800" data-fixture-banner>
        {FIXTURE_BANNER}
      </p>
      <section aria-label="Today's Games">
        <h2 className="type-section-heading mb-4 text-[#063f46]">Today&apos;s Games</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <GameCard key={game.id} game={game} presentation="scoreboard" />
          ))}
        </div>
      </section>
    </div>
  );
}
