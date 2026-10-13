import type { HistoricalContributor } from '@/lib/pregame-matchup/aggregate';

const OVERVIEW_COUNT = 3;

function Line({ player }: { player: HistoricalContributor }) {
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0">
      <div className="type-card-data truncate text-[#063f46]">{player.name}</div>
      <p className="type-secondary tabular-nums">
        {player.minutesPerGame.toFixed(1)} mpg · {player.pointsPerGame.toFixed(1)} ppg · {player.fgaPerGame.toFixed(1)} fga
        {player.usage != null ? ` · ${(player.usage * 100).toFixed(1)}% usg` : ''} · {player.games} gp
      </p>
    </li>
  );
}

function Side({ abbr, players }: { abbr: string; players: HistoricalContributor[] }) {
  const lead = players.slice(0, OVERVIEW_COUNT);
  const rest = players.slice(OVERVIEW_COUNT);
  return (
    <div className="min-w-0">
      <h3 className="type-secondary mb-1">{abbr}</h3>
      {players.length === 0 ? (
        <p className="type-secondary">No positive-minute games in the 2025–26 regular season.</p>
      ) : (
        <>
          <ul>{lead.map((player) => <Line key={player.playerId} player={player} />)}</ul>
          {rest.length > 0 ? (
            <details className="mt-2">
              <summary className="type-interactive cursor-pointer text-[#075B5C]">
                {rest.length} more historical contributor{rest.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1">
                {rest.map((player) => <Line key={player.playerId} player={player} />)}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export function PlayerContributors({
  awayAbbr,
  homeAbbr,
  label,
  away,
  home,
}: {
  awayAbbr: string;
  homeAbbr: string;
  label: string;
  away: HistoricalContributor[];
  home: HistoricalContributor[];
}) {
  return (
    <section id="section-contributors" className="scroll-mt-36 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" aria-labelledby="contributors">
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="contributors" className="type-section-heading text-[#063f46]">
          Last Season&apos;s Key Contributors
        </h2>
        <p className="type-metadata mt-1">{label}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-2">
        <Side abbr={awayAbbr} players={away} />
        <Side abbr={homeAbbr} players={home} />
      </div>
    </section>
  );
}
