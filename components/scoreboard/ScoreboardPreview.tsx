'use client';

import { GameCard, type Game } from '@/components/betting/GameCard';
import { loadScoreboardFixture, scoreboardGame } from '@/lib/scoreboard/fixtures';
import { mergeTodaysGames, scoreboardToSlateGame } from '@/lib/scoreboard/slate-merge';

const FIXTURE_BANNER = 'Fixture data for local preview. This is not a live scoreboard.';

/** Fixture market values matching the reference card screenshot. Not provider odds. */
const REFERENCE_MARKET: Game = {
  id: 'reference-market',
  gameDate: '2026-10-22',
  homeTeam: { id: '2', name: 'Boston Celtics', abbreviation: 'BOS', record: '64-18' },
  awayTeam: { id: '20', name: 'New York Knicks', abbreviation: 'NYK', record: '50-32' },
  startTime: '7:30 PM ET',
  homeOdds: { moneyline: -150, spread: -3.5, spreadOdds: -110 },
  awayOdds: { moneyline: 125, spread: 3.5, spreadOdds: -110 },
  overUnder: 224.5,
  overOdds: -110,
  underOdds: -110,
  homeImpliedProb: null,
  awayImpliedProb: null,
  isFavorite: 'home',
  isClose: false,
  hasOdds: true,
  matchupContext: 'Fixture context: Boston is rested; New York is on the second night of a back-to-back.',
};

function referencePregame(): Game {
  const base = scoreboardToSlateGame(
    scoreboardGame({
      game_id: 'reference-market',
      lifecycle: 'scheduled',
      season_type: 'regular',
      et_date: '2026-10-22',
      scheduled_tip: '2026-10-22T23:30:00.000Z',
      home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics' },
      visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks' },
    })
  )!;
  return { ...REFERENCE_MARKET, scoreboard: base.scoreboard, researchAvailable: false };
}

/** Dev-only preview of Today's Games cards. Does not call /api/scoreboard. */
export function ScoreboardPreview() {
  const games = mergeTodaysGames(loadScoreboardFixture());
  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-page-title text-[#063f46]">Today&apos;s Games preview</h1>
        <p className="type-body mt-2 max-w-3xl text-cc-secondary">
          The same game cards as the dashboard, one per lifecycle state. This page does not acquire games
          or call the provider.
        </p>
      </div>
      <p className="type-secondary rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800" data-fixture-banner>
        {FIXTURE_BANNER}
      </p>
      <section aria-label="Market reference">
        <h2 className="type-section-heading mb-4 text-[#063f46]">Market reference</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div data-reference="market">
            <GameCard game={REFERENCE_MARKET} samplePreview />
          </div>
          <div data-reference="scoreboard-pregame">
            <GameCard game={referencePregame()} presentation="scoreboard" />
          </div>
        </div>
      </section>
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
