import type { HistoricalContributor } from '@/lib/pregame-matchup/aggregate';
import type { MatchupContributors, ObservedRosterPlayer } from '@/lib/pregame-matchup/membership';

const OVERVIEW_COUNT = 3;

function HistoricalLine({ player }: { player: HistoricalContributor }) {
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0">
      <div className="type-card-data truncate text-[#063f46]">{player.name}</div>
      <p className="type-secondary tabular-nums">
        2025–26 · {player.minutesPerGame.toFixed(1)} mpg · {player.pointsPerGame.toFixed(1)} ppg · {player.fgaPerGame.toFixed(1)} fga
        {player.usage != null ? ` · ${(player.usage * 100).toFixed(1)}% usg` : ''} · {player.games} gp
      </p>
    </li>
  );
}

function HistoricalSide({
  abbr,
  players,
  emptyLabel,
}: {
  abbr: string;
  players: HistoricalContributor[];
  emptyLabel: string;
}) {
  const lead = players.slice(0, OVERVIEW_COUNT);
  const rest = players.slice(OVERVIEW_COUNT);
  return (
    <div className="min-w-0">
      <h3 className="type-secondary mb-1">{abbr}</h3>
      {players.length === 0 ? (
        <p className="type-secondary">{emptyLabel}</p>
      ) : (
        <>
          <ul>
            {lead.map((player) => <HistoricalLine key={player.playerId} player={player} />)}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-2">
              <summary className="type-interactive cursor-pointer text-[#075B5C]">
                {rest.length} more historical contributor{rest.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1">
                {rest.map((player) => <HistoricalLine key={player.playerId} player={player} />)}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function CurrentLine({ abbr, player }: { abbr: string; player: ObservedRosterPlayer }) {
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0">
      <div className="type-card-data truncate text-[#063f46]">{player.name}</div>
      {player.prior ? (
        <p className="type-secondary tabular-nums">
          2025–26 with {abbr} · {player.prior.minutesPerGame.toFixed(1)} mpg · {player.prior.pointsPerGame.toFixed(1)} ppg · {player.prior.fgaPerGame.toFixed(1)} fga
          {player.prior.usage != null ? ` · ${(player.prior.usage * 100).toFixed(1)}% usg` : ''} · {player.prior.games} gp
        </p>
      ) : (
        <p className="type-secondary">2025–26 sample with {abbr} unavailable</p>
      )}
    </li>
  );
}

function CurrentSide({
  abbr,
  players,
  unidentified,
}: {
  abbr: string;
  players: ObservedRosterPlayer[];
  unidentified: number;
}) {
  return (
    <div className="min-w-0">
      <h3 className="type-secondary mb-1">{abbr}</h3>
      {players.length === 0 ? (
        <p className="type-secondary">No named players were listed for {abbr} on this observation.</p>
      ) : (
        <ul>
          {players.map((player) => <CurrentLine key={player.playerId} abbr={abbr} player={player} />)}
        </ul>
      )}
      {unidentified > 0 ? (
        <p className="type-secondary mt-2">
          {unidentified} listed player{unidentified === 1 ? '' : 's'} could not be identified.
        </p>
      ) : null}
    </div>
  );
}

export function PlayerContributors({
  awayAbbr,
  homeAbbr,
  contributors,
}: {
  awayAbbr: string;
  homeAbbr: string;
  contributors: MatchupContributors;
}) {
  return (
    <section id="section-contributors" className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }} aria-labelledby="contributors">
      <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <h2 id="contributors" className="type-section-heading text-[#063f46]">
          Players
        </h2>
      </div>
      <div className="space-y-4 p-3" data-membership={contributors.membership}>
        <div>
          <h3 className="type-secondary text-[#063f46]">Observed 2026–27 roster</h3>
          {contributors.membership === 'shown' ? (
            <>
              <p className="type-metadata mt-1">{contributors.currentLabel}</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2" data-player-role="current">
                <CurrentSide abbr={awayAbbr} players={contributors.awayCurrent} unidentified={contributors.awayUnidentified} />
                <CurrentSide abbr={homeAbbr} players={contributors.homeCurrent} unidentified={contributors.homeUnidentified} />
              </div>
            </>
          ) : (
            <p className="type-secondary mt-1" data-player-role="current">{contributors.unavailableNote}</p>
          )}
        </div>
        <div className="border-t border-[#DCE9EA] pt-3" data-player-role="historical">
          <h3 className="type-secondary text-[#063f46]">2025–26 minute leaders</h3>
          <p className="type-metadata mt-1">{contributors.historicalLabel}</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <HistoricalSide abbr={awayAbbr} players={contributors.awayHistorical} emptyLabel={contributors.awayHistoricalEmpty} />
            <HistoricalSide abbr={homeAbbr} players={contributors.homeHistorical} emptyLabel={contributors.homeHistoricalEmpty} />
          </div>
        </div>
      </div>
    </section>
  );
}
