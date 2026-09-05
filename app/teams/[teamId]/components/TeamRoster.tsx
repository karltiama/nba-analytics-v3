import Link from 'next/link';
import {
  getTeamCanonicalRoster,
  groupRosterByPosition,
  rosterPlayerHref,
} from '@/lib/teams/team-roster-queries';
import { getInjuriesForPlayerIds } from '@/lib/teams/team-injury-queries';
import {
  mergeRosterAvailability,
  type RosterPlayerWithAvailability,
} from '@/lib/teams/roster-availability';
import { getLiveAvailabilitySeason } from '@/lib/season';
import { cn } from '@/lib/utils';

interface TeamRosterProps {
  teamId: string;
  /** Required analytics start-year from the team page season context. */
  season: string;
}

function availabilityClass(priority: 'high' | 'moderate' | 'low'): string {
  if (priority === 'high') return 'text-[#ff6b35]';
  if (priority === 'moderate') return 'text-[#f5a623]';
  return 'text-muted-foreground';
}

function RosterRow({ player }: { player: RosterPlayerWithAvailability }) {
  const href = rosterPlayerHref(player);
  const jerseyLabel =
    player.jersey != null && player.jersey !== '' ? `#${player.jersey}` : '—';
  const showStatsPending = player.playerId == null;
  const availability = player.availability;

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
        {availability ? (
          <span
            className={cn(
              'block text-[10px] font-medium truncate',
              availabilityClass(availability.priority)
            )}
          >
            {availability.label}
          </span>
        ) : showStatsPending ? (
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
  const roster = await getTeamCanonicalRoster(teamId, season);

  if (!roster || roster.length === 0) {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">Roster not available yet</p>
      </div>
    );
  }

  const liveSeason = getLiveAvailabilitySeason();
  let playersWithAvailability: RosterPlayerWithAvailability[] = roster.map(
    (p) => ({ ...p, availability: null })
  );

  try {
    const showAvailability = liveSeason === season;
    const bdlIds = showAvailability
      ? roster
          .map((p) => p.playerId)
          .filter((id): id is string => id != null && id !== '')
      : [];
    // 1 roster query (already done) + at most 1 injury query when viewing live season.
    const injuries =
      bdlIds.length > 0 ? await getInjuriesForPlayerIds(bdlIds) : [];
    const merged = mergeRosterAvailability({
      roster,
      injuries,
      rosterTeamId: teamId,
      viewedSeason: season,
      liveAvailabilitySeason: liveSeason,
    });
    playersWithAvailability = merged.players;
  } catch (err) {
    // Prefer roster without badges over losing membership UI.
    console.error('TeamRoster injury merge failed; rendering roster only', err);
  }

  const positionGroups = groupRosterByPosition(playersWithAvailability);

  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col min-h-0 xl:min-h-[calc(100vh-10rem)]">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02] shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roster
        </h3>
        <span className="text-[10px] px-2 py-0.5 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
          {playersWithAvailability.length}
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
