import Link from 'next/link';
import { getAnalyticsSeason } from '@/lib/season';
import {
  getTeamCanonicalRoster,
  groupRosterByPosition,
  rosterPlayerHref,
  type CanonicalRosterPlayer,
} from '@/lib/teams/team-roster-queries';

interface TeamRosterProps {
  teamId: string;
  /** Analytics start-year. Defaults to getAnalyticsSeason() (Production pin). */
  season?: string | null;
}

function RosterRow({ player }: { player: CanonicalRosterPlayer }) {
  const href = rosterPlayerHref(player);
  const jerseyLabel =
    player.jersey != null && player.jersey !== '' ? `#${player.jersey}` : '—';
  const showStatsPending = player.playerId == null;

  const inner = (
    <>
      <span className="w-8 text-center text-xs font-mono text-muted-foreground shrink-0">
        {jerseyLabel}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm truncate ${
            href
              ? 'text-white group-hover:text-[#00d4ff] transition-colors'
              : 'text-white'
          }`}
        >
          {player.displayName}
        </span>
        {showStatsPending ? (
          <span className="block text-[10px] text-muted-foreground/50">
            Stats pending
          </span>
        ) : null}
      </span>
      <span className="text-[10px] text-muted-foreground/60 font-medium shrink-0">
        {player.position || ''}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors border-b border-white/[0.03] group"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03]">
      {inner}
    </div>
  );
}

export async function TeamRoster({ teamId, season }: TeamRosterProps) {
  const currentSeason = season || getAnalyticsSeason();
  const roster = await getTeamCanonicalRoster(teamId, currentSeason);

  if (!roster || roster.length === 0) {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">Roster not available yet</p>
      </div>
    );
  }

  const positionGroups = groupRosterByPosition(roster);

  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col min-h-0 xl:min-h-[calc(100vh-10rem)]">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02] shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roster
        </h3>
        <span className="text-[10px] px-2 py-0.5 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
          {roster.length}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {positionGroups.map((group) => (
          <div key={group.name}>
            <div className="px-4 py-1.5 bg-white/[0.03] border-b border-white/5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group.name}
              </span>
            </div>
            {group.players.map((player) => (
              <RosterRow key={player.playerEntityId} player={player} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
