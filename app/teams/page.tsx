import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-white/5 transition-colors group min-h-11"
    >
      <span className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center">
        <span className="text-[10px] font-bold text-white/80">{team.abbreviation}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white group-hover:text-[#00d4ff] transition-colors truncate">
          {team.full_name}
        </span>
        <span className="block text-[10px] text-muted-foreground">{team.abbreviation}</span>
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
    getAllTeamsDefensiveRankings(seasonParam ? season : null),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        <header className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <Link href="/betting" className="text-[#00d4ff] hover:underline">
              Dashboard
            </Link>
            <span className="mx-1.5 text-white/20">/</span>
            Teams
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            NBA Teams
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Choose a team to explore roster, schedule, continuity, and season context.
          </p>
          {integrity.warning && (
            <p
              className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
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
                className="text-lg font-semibold text-white"
              >
                {conf.conferenceLabel}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {conf.divisions.map((div) => (
                  <div
                    key={div.division}
                    className="glass-card rounded-xl p-3 sm:p-4"
                  >
                    <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 px-2">
                      {div.division}
                    </h3>
                    <ul className="divide-y divide-white/5">
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
            <div className="glass-card rounded-xl p-6 text-center">
              <p className="text-muted-foreground">
                No current NBA teams are available in analytics.teams.
              </p>
            </div>
          )}
        </section>

        {/* Secondary: existing defensive rankings */}
        <section
          aria-labelledby="defensive-rankings-heading"
          className="space-y-4 border-t border-white/10 pt-8"
        >
          <div>
            <h2
              id="defensive-rankings-heading"
              className="text-lg font-semibold text-white"
            >
              Team Defensive Rankings
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Rankings are based on points allowed per game. Lower rank = better
              defense.
              {seasonParam && (
                <span className="ml-1">Season: {season}</span>
              )}
            </p>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Conference</TableHead>
                    <TableHead>Division</TableHead>
                    <TableHead className="text-right">Points Allowed</TableHead>
                    <TableHead className="text-right">Rebounds Allowed</TableHead>
                    <TableHead className="text-right">Assists Allowed</TableHead>
                    <TableHead className="text-right">FG% Allowed</TableHead>
                    <TableHead className="text-right">3P% Allowed</TableHead>
                    <TableHead className="text-right">Games</TableHead>
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
                    <TableRow key={team.team_id}>
                      <TableCell className="font-bold">
                        #{team.points_allowed_rank}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={teamPageSeasonHref({
                            teamId: team.team_id,
                            season,
                            defaultSeason,
                          })}
                          className="font-medium text-white hover:text-[#00d4ff] hover:underline"
                        >
                          {team.abbreviation}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {team.full_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {team.conference || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {team.division || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {team.points_allowed_per_game != null
                          ? Number(team.points_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-muted-foreground">
                          Rank: #{team.points_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {team.rebounds_allowed_per_game != null
                          ? Number(team.rebounds_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-muted-foreground">
                          Rank: #{team.rebounds_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {team.assists_allowed_per_game != null
                          ? Number(team.assists_allowed_per_game).toFixed(1)
                          : '—'}
                        <div className="text-xs text-muted-foreground">
                          Rank: #{team.assists_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {team.fg_pct_allowed != null
                          ? Number(team.fg_pct_allowed).toFixed(1) + '%'
                          : '—'}
                        <div className="text-xs text-muted-foreground">
                          Rank: #{team.fg_pct_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {team.three_pct_allowed != null
                          ? Number(team.three_pct_allowed).toFixed(1) + '%'
                          : '—'}
                        <div className="text-xs text-muted-foreground">
                          Rank: #{team.three_pct_allowed_rank}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {team.games_played || 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rankings.length === 0 && (
              <div className="p-6">
                <p className="text-sm text-muted-foreground">
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
