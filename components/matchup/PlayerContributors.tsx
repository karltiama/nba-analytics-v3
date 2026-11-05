import type { HistoricalContributor } from '@/lib/pregame-matchup/aggregate';
import type { MatchupContributors, ObservedRosterPlayer } from '@/lib/pregame-matchup/membership';
import { MatchupSection } from '@/components/matchup/MatchupSection';
import { playerPageHref } from '@/lib/pregame-matchup/href';
import Link from 'next/link';
import { CURRENT_PLAYER_MIN_GAMES, type CurrentPlayer, type CurrentPlayers, type CurrentPlayersTeam } from '@/lib/pregame-matchup/current-players';

const OVERVIEW_COUNT = 3;

/** Tonight's listed injuries for one team, by injury-report display name (usually the last name). */
export type SideInjuries = Array<{ name: string; status: string }>;

const STATUS_TEXT: Record<string, string> = { Q: 'Questionable' };

/**
 * Status for each full name. A report name tags a player only when exactly one
 * listed player on that side ends with it, so a shared surname tags nobody.
 */
function injuryStatuses(names: string[], injuries: SideInjuries | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const injury of injuries ?? []) {
    const key = injury.name.trim().toLowerCase();
    if (!key) continue;
    const matches = names.filter((name) => {
      const full = name.trim().toLowerCase();
      return full === key || full.endsWith(` ${key}`);
    });
    if (matches.length === 1) out.set(matches[0]!, STATUS_TEXT[injury.status] ?? injury.status);
  }
  return out;
}

function InjuryTag({ status }: { status: string | undefined }) {
  if (!status) return null;
  return (
    <span className="type-badge ml-2 shrink-0 rounded-full border border-[#F2C9C4] bg-[#FDF3F2] px-2 py-0.5 text-[#8A2A1F]" data-injury-tag>
      {status}
    </span>
  );
}

function PlayerName({ name, status, playerId }: { name: string; status?: string; playerId?: string }) {
  return (
    <div className="flex min-w-0 items-center">
      {playerId ? (
        <Link href={playerPageHref(playerId)} className="type-card-data truncate text-[#063f46] hover:text-[#075B5C] hover:underline">
          {name}
        </Link>
      ) : (
        <span className="type-card-data truncate text-[#063f46]">{name}</span>
      )}
      <InjuryTag status={status} />
    </div>
  );
}

function HistoricalLine({ player, status }: { player: HistoricalContributor; status?: string }) {
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0">
      <PlayerName name={player.name} status={status} playerId={player.playerId} />
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
  injuries,
}: {
  abbr: string;
  players: HistoricalContributor[];
  emptyLabel: string;
  injuries?: SideInjuries;
}) {
  const statuses = injuryStatuses(players.map((player) => player.name), injuries);
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
            {lead.map((player) => <HistoricalLine key={player.playerId} player={player} status={statuses.get(player.name)} />)}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-2">
              <summary className="type-interactive cursor-pointer text-[#075B5C]">
                {rest.length} more historical contributor{rest.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1">
                {rest.map((player) => <HistoricalLine key={player.playerId} player={player} status={statuses.get(player.name)} />)}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function CurrentLine({ abbr, player, status }: { abbr: string; player: ObservedRosterPlayer; status?: string }) {
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0">
      <PlayerName name={player.name} status={status} />
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
  injuries,
}: {
  abbr: string;
  players: ObservedRosterPlayer[];
  unidentified: number;
  injuries?: SideInjuries;
}) {
  const statuses = injuryStatuses(players.map((player) => player.name), injuries);
  return (
    <div className="min-w-0">
      <h3 className="type-secondary mb-1">{abbr}</h3>
      {players.length === 0 ? (
        <p className="type-secondary">No named players were listed for {abbr} on this observation.</p>
      ) : (
        <ul>
          {players.map((player) => <CurrentLine key={player.playerId} abbr={abbr} player={player} status={statuses.get(player.name)} />)}
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

function statLine(p: { minutesPerGame: number; pointsPerGame: number; fgaPerGame: number; usage: number | null }): string {
  return `${p.minutesPerGame.toFixed(1)} mpg · ${p.pointsPerGame.toFixed(1)} ppg · ${p.fgaPerGame.toFixed(1)} fga${p.usage != null ? ` · ${(p.usage * 100).toFixed(1)}% usg` : ''}`;
}

function SeasonLine({ player, team, current }: { player: CurrentPlayer; team: CurrentPlayersTeam; current: CurrentPlayers }) {
  const small = player.games < CURRENT_PLAYER_MIN_GAMES;
  return (
    <li className="min-w-0 border-b border-[#DCE9EA] py-2 last:border-0" data-current-player={player.playerId}>
      <div className="flex min-w-0 items-center">
        <Link href={playerPageHref(player.playerId)} className="type-card-data truncate text-[#063f46] hover:text-[#075B5C] hover:underline">
          {player.name}
        </Link>
        <InjuryTag status={player.status ?? undefined} />
        {player.newToTeam ? (
          <span className="type-badge ml-2 shrink-0 rounded-full border border-[#DCE9EA] bg-[#F8FBFA] px-2 py-0.5 text-[#4a6366]" data-new-to-team>
            New to {team.abbr}
          </span>
        ) : null}
      </div>
      <p className="type-secondary tabular-nums">
        {player.games}
        {team.teamGames > 0 ? ` of ${team.teamGames}` : ''} gp · {statLine(player)}
        {small ? <span className="text-[#7A4B05]"> · small sample</span> : null}
      </p>
      <p className="type-metadata tabular-nums">
        {player.prior
          ? `${current.priorLabel} with ${team.abbr}: ${statLine(player.prior)} · ${player.prior.games} gp`
          : player.newToTeam
            ? `Played for another team in ${current.priorLabel}`
            : `No ${current.priorLabel} games`}
      </p>
    </li>
  );
}

function SeasonSide({ team, current }: { team: CurrentPlayersTeam; current: CurrentPlayers }) {
  const lead = team.players.slice(0, OVERVIEW_COUNT + 2);
  const rest = team.players.slice(OVERVIEW_COUNT + 2);
  return (
    <div className="min-w-0" data-current-team={team.abbr}>
      <h3 className="type-secondary mb-1">{team.abbr}</h3>
      <ul>
        {lead.map((p) => <SeasonLine key={p.playerId} player={p} team={team} current={current} />)}
      </ul>
      {rest.length > 0 ? (
        <details className="mt-2">
          <summary className="type-interactive cursor-pointer text-[#075B5C]">
            {rest.length} more player{rest.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1">
            {rest.map((p) => <SeasonLine key={p.playerId} player={p} team={team} current={current} />)}
          </ul>
        </details>
      ) : null}
      {team.notYetPlayed.length > 0 ? (
        <p className="type-metadata mt-2" data-not-yet-played>
          Not played for {team.abbr} this season: {team.notYetPlayed.map((p) => `${p.name} (${p.status})`).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

export function PlayerContributors({
  awayAbbr,
  homeAbbr,
  contributors,
  flow = false,
  awayInjuries,
  homeInjuries,
  current = null,
}: {
  awayAbbr: string;
  homeAbbr: string;
  contributors: MatchupContributors;
  /** This season's players from game logs. When present it leads and last season folds away. */
  current?: CurrentPlayers | null;
  flow?: boolean;
  /** Tonight's report, used only to tag listed players. */
  awayInjuries?: SideInjuries;
  homeInjuries?: SideInjuries;
}) {
  const historical = (
    <>
      <p className="type-metadata mt-1">{contributors.historicalLabel}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HistoricalSide abbr={awayAbbr} players={contributors.awayHistorical} emptyLabel={contributors.awayHistoricalEmpty} injuries={awayInjuries} />
        <HistoricalSide abbr={homeAbbr} players={contributors.homeHistorical} emptyLabel={contributors.homeHistoricalEmpty} injuries={homeInjuries} />
      </div>
    </>
  );
  return (
    <MatchupSection id="section-contributors" headingId="contributors" title="Players" flow={flow}>
      <div className="space-y-4" data-membership={contributors.membership}>
        {current ? (
          <div data-player-role="season">
            <h3 className="type-secondary text-[#063f46]">{current.seasonLabel} so far</h3>
            <p className="type-metadata mt-1">
              Everyone who has played for each team this season and is still with it, by total minutes. Last season&apos;s line
              with the same team sits underneath.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {current.teams.map((team) => <SeasonSide key={team.teamId} team={team} current={current} />)}
            </div>
          </div>
        ) : null}
        {current && contributors.membership !== 'shown' ? null : (
        <div>
          <h3 className="type-secondary text-[#063f46]">Observed 2026–27 roster</h3>
          {contributors.membership === 'shown' ? (
            <>
              <p className="type-metadata mt-1">{contributors.currentLabel}</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2" data-player-role="current">
                <CurrentSide abbr={awayAbbr} players={contributors.awayCurrent} unidentified={contributors.awayUnidentified} injuries={awayInjuries} />
                <CurrentSide abbr={homeAbbr} players={contributors.homeCurrent} unidentified={contributors.homeUnidentified} injuries={homeInjuries} />
              </div>
            </>
          ) : (
            <p className="type-secondary mt-1" data-player-role="current">{contributors.unavailableNote}</p>
          )}
        </div>
        )}
        {current ? (
          <details className="border-t border-[#DCE9EA] pt-3" data-player-role="historical">
            <summary className="type-interactive cursor-pointer text-[#075B5C]">2025–26 minute leaders</summary>
            {current.teams.some((team) => (current.departed[team.teamId] ?? []).length > 0) ? (
              <p className="type-metadata mt-1" data-departed>
                {current.teams
                  .filter((team) => (current.departed[team.teamId] ?? []).length > 0)
                  .map((team) => `No longer with ${team.abbr}: ${current.departed[team.teamId]!.join(', ')}.`)
                  .join(' ')}
              </p>
            ) : null}
            {historical}
          </details>
        ) : (
          <div className="border-t border-[#DCE9EA] pt-3" data-player-role="historical">
            <h3 className="type-secondary text-[#063f46]">2025–26 minute leaders</h3>
            {historical}
          </div>
        )}
      </div>
    </MatchupSection>
  );
}
