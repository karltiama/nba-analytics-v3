import Link from 'next/link';
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
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 items-center py-1.5 px-1 rounded-md hover:bg-white/4 transition-colors text-sm"
    >
      <span className="text-xs text-muted-foreground tabular-nums">{date}</span>
      <span className="text-white font-medium truncate">{opp}</span>
      <span className="text-xs text-muted-foreground text-right whitespace-nowrap">
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
      ? 'text-[#39ff14]'
      : game.result === 'L'
        ? 'text-[#ff6b35]'
        : 'text-muted-foreground';

  return (
    <Link
      href={compactGameHref(game.game_id)}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 items-center py-1.5 px-1 rounded-md hover:bg-white/4 transition-colors text-sm"
    >
      <span className="text-xs text-muted-foreground tabular-nums">{date}</span>
      <span className="text-white font-medium truncate">{opp}</span>
      <span
        className={`text-xs font-mono font-semibold text-right whitespace-nowrap ${resultColor}`}
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
      className="glass-card rounded-xl p-4"
      data-analytics-season={season}
      aria-label={`${seasonLabel} upcoming and recent games`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-white">
          {showRecentColumn ? 'Upcoming / Recent' : 'Upcoming'}
        </h2>
        <Link
          href={fullScheduleHref(routeTeamId, season)}
          className="text-xs text-[#00d4ff] hover:underline shrink-0"
        >
          Full schedule →
        </Link>
      </div>

      <div className={gridClass}>
        <div>
          {showRecentColumn && (
            <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Upcoming
            </h3>
          )}
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">No upcoming games</p>
          ) : (
            <div className="divide-y divide-white/5">
              {upcoming.map((g) => (
                <UpcomingRow key={g.game_id} game={g} />
              ))}
            </div>
          )}
        </div>

        {showRecentColumn ? (
          <div>
            <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Recent
            </h3>
            <div className="divide-y divide-white/5">
              {recent.map((g) => (
                <RecentRow key={g.game_id} game={g} />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            No completed games yet
          </p>
        )}
      </div>
    </section>
  );
}
