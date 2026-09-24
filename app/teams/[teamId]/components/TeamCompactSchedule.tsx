import Link from 'next/link';
import { TeamLogo } from '@/components/nba/TeamLogo';
import type { CompactScheduleGame } from '@/lib/teams/team-compact-schedule';
import {
  compactGameHref,
  formatCompactScheduleDate,
  formatCompactScoreLine,
  formatCompactTipoff,
  formatOpponentLine,
  fullScheduleHref,
} from '@/lib/teams/team-compact-schedule';

type TeamCompactScheduleProps = {
  routeTeamId: string;
  season: string;
  seasonLabel: string;
  upcoming: CompactScheduleGame[];
  recent: CompactScheduleGame[];
};

function UpcomingRow({ game }: { game: CompactScheduleGame }) {
  const date = formatCompactScheduleDate(game.start_time);
  const opp = formatOpponentLine(game.is_home, game.opponent_abbr);
  const tip = formatCompactTipoff(game.start_time);
  const showStatus =
    game.status === 'Postponed' ||
    game.status === 'Canceled' ||
    game.status === 'In Progress' ||
    game.status === 'Unknown';

  return (
    <Link
      href={compactGameHref(game.game_id)}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 items-center py-1.5 px-1 rounded-md hover:bg-[#f7f9f7] transition-colors text-sm"
    >
      <span className="type-metadata tabular-nums">{date}</span>
      <span className="type-table-data flex items-center gap-1.5 min-w-0 text-[#063f46]">
        <TeamLogo team={game.opponent_abbr} size="xs" decorative />
        <span className="truncate">{opp}</span>
      </span>
      <span className="type-metadata text-right whitespace-nowrap">
        {showStatus ? game.status : tip}
      </span>
    </Link>
  );
}

function RecentRow({ game }: { game: CompactScheduleGame }) {
  const date = formatCompactScheduleDate(game.start_time);
  const opp = formatOpponentLine(game.is_home, game.opponent_abbr);
  const score = formatCompactScoreLine(
    game.result,
    game.team_score,
    game.opponent_score
  );
  const resultColor =
    game.result === 'W'
      ? 'text-[#20B95A]'
      : game.result === 'L'
        ? 'text-[#c2410c]'
        : 'text-[#4a6366]';

  return (
    <Link
      href={compactGameHref(game.game_id)}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 items-center py-1.5 px-1 rounded-md hover:bg-[#f7f9f7] transition-colors text-sm"
    >
      <span className="type-metadata tabular-nums">{date}</span>
      <span className="type-table-data flex items-center gap-1.5 min-w-0 text-[#063f46]">
        <TeamLogo team={game.opponent_abbr} size="xs" decorative />
        <span className="truncate">{opp}</span>
      </span>
      <span
        className={`type-badge text-right whitespace-nowrap ${resultColor}`}
      >
        {score}
      </span>
    </Link>
  );
}

export function TeamCompactSchedule({
  routeTeamId,
  season,
  seasonLabel,
  upcoming,
  recent,
}: TeamCompactScheduleProps) {
  const showRecentColumn = recent.length > 0;
  // Preseason: don't leave a loud empty half-column beside upcoming.
  const gridClass = showRecentColumn
    ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
    : 'grid grid-cols-1 gap-2';

  return (
    <section
      className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4"
      data-analytics-season={season}
      aria-label={`${seasonLabel} upcoming and recent games`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="type-section-heading text-[#063f46]">
          {showRecentColumn ? 'Upcoming / Recent' : 'Upcoming'}
        </h2>
        <Link
          href={fullScheduleHref(routeTeamId, season)}
          className="type-interactive text-[#075B5C] hover:underline shrink-0"
        >
          Full schedule →
        </Link>
      </div>

      <div className={gridClass}>
        <div>
          {showRecentColumn && (
            <h3 className="type-metadata mb-1.5">
              Upcoming
            </h3>
          )}
          {upcoming.length === 0 ? (
            <p className="type-secondary py-1">No upcoming games</p>
          ) : (
            <div className="divide-y divide-[#DCE9EA]">
              {upcoming.map((g) => (
                <UpcomingRow key={g.game_id} game={g} />
              ))}
            </div>
          )}
        </div>

        {showRecentColumn ? (
          <div>
            <h3 className="type-metadata mb-1.5">
              Recent
            </h3>
            <div className="divide-y divide-[#DCE9EA]">
              {recent.map((g) => (
                <RecentRow key={g.game_id} game={g} />
              ))}
            </div>
          </div>
        ) : (
          <p className="type-secondary">
            No completed games yet
          </p>
        )}
      </div>
    </section>
  );
}
