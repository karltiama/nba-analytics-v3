import { getBBRefTeamSeasonStats } from '@/lib/teams/bbref-queries';

interface BBRefSeasonStatsProps {
  teamId: string;
  teamAbbr?: string;
}

export async function BBRefSeasonStats({ teamId, teamAbbr }: BBRefSeasonStatsProps) {
  const stats = await getBBRefTeamSeasonStats(teamId);

  if (!stats || !stats.games_played || Number(stats.games_played) === 0) {
    return null;
  }

  const gamesPlayed = Number(stats.games_played);
  const avgPoints = Number(stats.avg_points || 0);
  const avgPointsAgainst = Number(stats.avg_points_against || 0);
  const scoringDiff = Number(stats.scoring_differential || 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        BBRef Season Stats {teamAbbr && `(${teamAbbr})`}
      </h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Games Played</div>
          <div className="text-2xl font-bold">{gamesPlayed}</div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Points Per Game</div>
          <div className="text-2xl font-bold">{avgPoints.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Points Against</div>
          <div className="text-2xl font-bold">{avgPointsAgainst.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Scoring Differential</div>
          <div className={`text-2xl font-bold ${
            scoringDiff > 0 
              ? 'text-green-600 dark:text-green-400' 
              : scoringDiff < 0 
              ? 'text-red-600 dark:text-red-400' 
              : ''
          }`}>
            {scoringDiff > 0 ? '+' : ''}{scoringDiff.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Shooting Stats */}
        <div>
          <h3 className="text-lg font-semibold mb-3 text-black dark:text-zinc-50">Shooting</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">FG%</span>
              <span className="font-medium">{Number(stats.fg_pct || 0).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">FGM/FGA (Avg)</span>
              <span className="font-medium">
                {Number(stats.avg_fgm || 0).toFixed(1)} / {Number(stats.avg_fga || 0).toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">FGM/FGA (Total)</span>
              <span className="font-medium">
                {Number(stats.total_fgm || 0)} / {Number(stats.total_fga || 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">3P%</span>
              <span className="font-medium">{Number(stats.three_pct || 0).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">3PM/3PA (Avg)</span>
              <span className="font-medium">
                {Number(stats.avg_3pm || 0).toFixed(1)} / {Number(stats.avg_3pa || 0).toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">FT%</span>
              <span className="font-medium">{Number(stats.ft_pct || 0).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">FTM/FTA (Avg)</span>
              <span className="font-medium">
                {Number(stats.avg_ftm || 0).toFixed(1)} / {Number(stats.avg_fta || 0).toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Other Stats */}
        <div>
          <h3 className="text-lg font-semibold mb-3 text-black dark:text-zinc-50">Other Stats</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Rebounds (Avg)</span>
              <span className="font-medium">{Number(stats.avg_rebounds || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Offensive Rebounds (Avg)</span>
              <span className="font-medium">{Number(stats.avg_orb || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Defensive Rebounds (Avg)</span>
              <span className="font-medium">{Number(stats.avg_drb || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Assists (Avg)</span>
              <span className="font-medium">{Number(stats.avg_assists || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Steals (Avg)</span>
              <span className="font-medium">{Number(stats.avg_steals || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Blocks (Avg)</span>
              <span className="font-medium">{Number(stats.avg_blocks || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Turnovers (Avg)</span>
              <span className="font-medium">{Number(stats.avg_turnovers || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Personal Fouls (Avg)</span>
              <span className="font-medium">{Number(stats.avg_pf || 0).toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Possessions (Avg)</span>
              <span className="font-medium">{Number(stats.avg_possessions || 0).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Totals Section */}
      <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
        <h3 className="text-lg font-semibold mb-3 text-black dark:text-zinc-50">Season Totals</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-zinc-600 dark:text-zinc-400">Total Points</div>
            <div className="font-medium">{Number(stats.total_points || 0)}</div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-400">Total Rebounds</div>
            <div className="font-medium">{Number(stats.total_rebounds || 0)}</div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-400">Total Assists</div>
            <div className="font-medium">{Number(stats.total_assists || 0)}</div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-400">Total Personal Fouls</div>
            <div className="font-medium">{Number(stats.total_pf || 0)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}


