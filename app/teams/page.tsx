import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { getAllTeamsDefensiveRankings } from '@/lib/teams/defensive-rankings';
import { listCurrentNbaTeams } from '@/lib/teams/team-directory-queries';
import { teamPageSeasonHref } from '@/lib/teams/team-page-season';
import { getAnalyticsSeason, parseSeasonStartYear } from '@/lib/season';
import type { TeamInfo } from '@/lib/teams/types';

function TeamDirectoryItem({
  team,
  season,
  defaultSeason,
}: {
  team: TeamInfo;
  season: string;
  defaultSeason: string;
}) {
  const href = teamPageSeasonHref({
    teamId: team.team_id,
    season,
    defaultSeason,
  });

  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#f7f9f7] transition-colors group min-h-9"
    >
      <TeamLogo team={team.abbreviation} size="xs" decorative />
      <span className="min-w-0 flex-1 text-sm font-medium text-[#063f46] group-hover:text-[#075B5C] transition-colors truncate">
        {team.full_name}
      </span>
      <span className="text-[11px] font-semibold tabular-nums text-[#8aa0a3] shrink-0">
        {team.abbreviation}
      </span>
    </Link>
  );
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const defaultSeason = getAnalyticsSeason();
  const season = parseSeasonStartYear(seasonParam) ?? defaultSeason;

  const [{ groups, integrity }, rankings] = await Promise.all([
    listCurrentNbaTeams(),
    getAllTeamsDefensiveRankings(season),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        <header className="space-y-2">
          <p className="text-xs text-[#4a6366]">
            <Link href="/betting" className="text-[#075B5C] hover:underline">
              Dashboard
            </Link>
            <span className="mx-1.5 text-[#DCE9EA]">/</span>
            Teams
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#063f46] tracking-tight">
            NBA Teams
          </h1>
          <p className="text-sm text-[#4a6366] max-w-2xl">
            Choose a team to explore roster, schedule, continuity, and season context.
          </p>
          {integrity.warning && (
            <p
              className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              role="status"
            >
              {integrity.warning}
            </p>
          )}
        </header>

        {/* Primary: franchise discovery */}
        <section aria-labelledby="teams-directory-heading" className="space-y-8">
          <h2 id="teams-directory-heading" className="sr-only">
            Team directory by conference
          </h2>

          {groups.map((conf) => (
            <section
              key={conf.conference}
              aria-labelledby={`conf-${conf.conference}`}
              className="space-y-4"
            >
              <h2
                id={`conf-${conf.conference}`}
                className="text-lg font-semibold text-[#063f46]"
              >
                {conf.conferenceLabel}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {conf.divisions.map((div) => (
                  <div
                    key={div.division}
                    className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden"
                  >
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#4a6366] px-3 py-2 bg-[#F8FBFA] border-b border-[#DCE9EA]">
                      {div.division}
                    </h3>
                    <ul className="p-1">
                      {div.teams.map((team) => (
                        <li key={team.team_id}>
                          <TeamDirectoryItem
                            team={team}
                            season={season}
                            defaultSeason={defaultSeason}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {integrity.count === 0 && (
            <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-6 text-center">
              <p className="text-[#4a6366]">
                No current NBA teams are available in analytics.teams.
              </p>
            </div>
          )}
        </section>

        {/* Secondary: existing defensive rankings */}
        <section
          aria-labelledby="defensive-rankings-heading"
          className="space-y-4 border-t border-[#DCE9EA] pt-8"
        >
          <div>
            <h2
              id="defensive-rankings-heading"
              className="text-lg font-semibold text-[#063f46]"
            >
              Team Defensive Rankings
            </h2>
            <p className="text-xs text-[#4a6366] mt-1">
              Rankings are based on points allowed per game. Lower rank = better
              defense.
              {seasonParam && (
                <span className="ml-1">Season: {season}</span>
              )}
            </p>
          </div>

          <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#DCE9EA] hover:bg-transparent">
                    <TableHead className="text-[#4a6366]">Rank</TableHead>
                    <TableHead className="text-[#4a6366]">Team</TableHead>
                    <TableHead className="text-[#4a6366]">Conference</TableHead>
                    <TableHead className="text-[#4a6366]">Division</TableHead>
                    <TableHead className="text-right text-[#4a6366]">Points Allowed</TableHead>
                    <TableHead className="text-right text-[#4a6366]">Rebounds Allowed</TableHead>
                    <TableHead className="text-right text-[#4a6366]">Assists Allowed</TableHead>
                    <TableHead className="text-right text-[#4a6366]">FG% Allowed</TableHead>
                    <TableHead className="text-right text-[#4a6366]">3P% Allowed</TableHead>
                    <TableHead className="text-right text-[#4a6366]">Games</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankings.map((team: {
                    team_id: string;
                    points_allowed_rank: number;
                    abbreviation: string;
                    full_name: string;
                    conference?: string;
                    division?: string;
                    points_allowed_per_game?: number | null;
                    rebounds_allowed_per_game?: number | null;
                    assists_allowed_per_game?: number | null;
                    fg_pct_allowed?: number | null;
                    three_pct_allowed?: number | null;
                    rebounds_allowed_rank?: number;
                    assists_allowed_rank?: number;
                    fg_pct_allowed_rank?: number;
                    three_pct_allowed_rank?: number;
                    games_played?: number;
                  }) => (
                    <TableRow key={team.team_id} className="border-[#DCE9EA] hover:bg-[#f7f9f7]">
                      <TableCell className="font-bold text-[#063f46]">
                        #{team.points_allowed_rank}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={teamPageSeasonHref({
                            teamId: team.team_id,
                            season,
                            defaultSeason,
                          })}
                          className="flex items-center gap-2 font-medium text-[#063f46] hover:text-[#075B5C] hover:underline"
                        >
                          <TeamLogo team={team.abbreviation} size="xs" decorative />
                          <span>
                            <span className="block">{team.abbreviation}</span>
                            <span className="block text-xs font-normal text-[#4a6366] no-underline">
                              {team.full_name}
                            </span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-[#4a6366]">
                        {team.conference || '—'}
                      </TableCell>
                      <TableCell className="text-[#4a6366]">
                        {team.division || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-[#063f46]">
                        {team.points_allowed_per_game != null
                          ? Number(team.points_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-[#4a6366]">
                          Rank: #{team.points_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[#063f46]">
                        {team.rebounds_allowed_per_game != null
                          ? Number(team.rebounds_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-[#4a6366]">
                          Rank: #{team.rebounds_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[#063f46]">
                        {team.assists_allowed_per_game != null
                          ? Number(team.assists_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-[#4a6366]">
                          Rank: #{team.assists_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[#063f46]">
                        {team.fg_pct_allowed != null
                          ? Number(team.fg_pct_allowed).toFixed(1) + '%'
                          : '—'}
                        <div className="text-xs text-[#4a6366]">
                          Rank: #{team.fg_pct_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[#063f46]">
                        {team.three_pct_allowed != null
                          ? Number(team.three_pct_allowed).toFixed(1) + '%'
                          : '—'}
                        <div className="text-xs text-[#4a6366]">
                          Rank: #{team.three_pct_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[#4a6366]">
                        {team.games_played || 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rankings.length === 0 && (
              <div className="p-6">
                <p className="text-sm text-[#4a6366]">
                  No defensive rankings available yet. Teams need at least 5 games
                  played.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>
  );
}
