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
  if (priority === 'high') return 'text-[#c2410c]';
  if (priority === 'moderate') return 'text-[#b45309]';
  return 'text-[#4a6366]';
}

function RosterRow({ player }: { player: RosterPlayerWithAvailability }) {
  const href = rosterPlayerHref(player);
  const jerseyLabel =
    player.jersey != null && player.jersey !== '' ? `#${player.jersey}` : '—';
  const showStatsPending = player.playerId == null;
  const availability = player.availability;

  const inner = (
    <>
      <span className="type-metadata w-8 text-center font-mono shrink-0">
        {jerseyLabel}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`type-table-data block truncate ${
            href
              ? 'text-[#063f46] group-hover:text-[#075B5C] transition-colors'
              : 'text-[#063f46]'
          }`}
        >
          {player.displayName}
        </span>
        {availability ? (
          <span
            className={cn(
              'type-badge block truncate',
              availabilityClass(availability.priority)
            )}
            title={availability.label}
          >
            {availability.label}
          </span>
        ) : showStatsPending ? (
          <span className="type-metadata block truncate">
            Stats pending
          </span>
        ) : null}
      </span>
      <span className="type-secondary shrink-0">
        {player.position || ''}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-2 hover:bg-[#f7f9f7] transition-colors border-b border-[#DCE9EA] group"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[#DCE9EA]">
      {inner}
    </div>
  );
}

export async function TeamRoster({ teamId, season }: TeamRosterProps) {
  const roster = await getTeamCanonicalRoster(teamId, season);

  if (!roster || roster.length === 0) {
    return (
      <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 text-center">
        <p className="type-secondary">Roster not available yet</p>
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
    <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0 xl:min-h-[calc(100vh-10rem)]">
      <div className="px-4 py-2.5 border-b border-[#DCE9EA] flex items-center justify-between bg-[#F8FBFA] shrink-0">
        <h3 className="type-section-heading text-[#063f46]">
          Roster
        </h3>
        <span className="type-badge px-2 py-0.5 bg-[#55ddb1]/30 text-[#063f46] rounded-full">
          {playersWithAvailability.length}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {positionGroups.map((group) => (
          <div key={group.name}>
            <div className="px-4 py-1.5 bg-[#F8FBFA] border-b border-[#DCE9EA]">
              <span className="type-metadata">
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
