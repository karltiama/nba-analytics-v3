interface PlayerSeasonStatsProps {
  seasonStats: {
    games_played?: number;
    games_active?: number;
    games_started?: number;
    total_points?: number;
    avg_points?: number;
    total_rebounds?: number;
    avg_rebounds?: number;
    total_assists?: number;
    avg_assists?: number;
    total_steals?: number;
    avg_steals?: number;
    total_blocks?: number;
    avg_blocks?: number;
    total_turnovers?: number;
    avg_turnovers?: number;
    total_fgm?: number;
    total_fga?: number;
    fg_pct?: number;
    total_3pm?: number;
    total_3pa?: number;
    three_pct?: number;
    total_ftm?: number;
    total_fta?: number;
    ft_pct?: number;
    avg_minutes?: number;
    total_minutes?: number;
    avg_plus_minus?: number;
  };
}

export function PlayerSeasonStats({ seasonStats }: PlayerSeasonStatsProps) {
  if (!seasonStats.games_played || seasonStats.games_played === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-600 dark:text-zinc-400">
          No statistics available for this player.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Season Stats
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Games Played</div>
          <div className="text-2xl font-bold">{seasonStats.games_played || 0}</div>
          {seasonStats.games_started !== undefined && seasonStats.games_started > 0 && (
            <div className="text-xs text-zinc-500">
              {seasonStats.games_started} starts
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Points</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_points ? Number(seasonStats.avg_points).toFixed(1) : '-'}
          </div>
          {seasonStats.total_points !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_points} total
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Rebounds</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_rebounds ? Number(seasonStats.avg_rebounds).toFixed(1) : '-'}
          </div>
          {seasonStats.total_rebounds !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_rebounds} total
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Assists</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_assists ? Number(seasonStats.avg_assists).toFixed(1) : '-'}
          </div>
          {seasonStats.total_assists !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_assists} total
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Steals</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_steals ? Number(seasonStats.avg_steals).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Blocks</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_blocks ? Number(seasonStats.avg_blocks).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Turnovers</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_turnovers ? Number(seasonStats.avg_turnovers).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">FG%</div>
          <div className="text-2xl font-bold">
            {seasonStats.fg_pct ? Number(seasonStats.fg_pct).toFixed(1) + '%' : '-'}
          </div>
          {seasonStats.total_fgm !== undefined && seasonStats.total_fga !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_fgm}/{seasonStats.total_fga}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">3P%</div>
          <div className="text-2xl font-bold">
            {seasonStats.three_pct ? Number(seasonStats.three_pct).toFixed(1) + '%' : '-'}
          </div>
          {seasonStats.total_3pm !== undefined && seasonStats.total_3pa !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_3pm}/{seasonStats.total_3pa}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">FT%</div>
          <div className="text-2xl font-bold">
            {seasonStats.ft_pct ? Number(seasonStats.ft_pct).toFixed(1) + '%' : '-'}
          </div>
          {seasonStats.total_ftm !== undefined && seasonStats.total_fta !== undefined && (
            <div className="text-xs text-zinc-500">
              {seasonStats.total_ftm}/{seasonStats.total_fta}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Minutes</div>
          <div className="text-2xl font-bold">
            {seasonStats.avg_minutes ? Number(seasonStats.avg_minutes).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">+/-</div>
          <div className={`text-2xl font-bold ${
            (seasonStats.avg_plus_minus || 0) > 0 
              ? 'text-green-600' 
              : (seasonStats.avg_plus_minus || 0) < 0 
              ? 'text-red-600' 
              : ''
          }`}>
            {seasonStats.avg_plus_minus !== null && seasonStats.avg_plus_minus !== undefined
              ? (Number(seasonStats.avg_plus_minus) > 0 ? '+' : '') + Number(seasonStats.avg_plus_minus).toFixed(1)
              : '-'}
          </div>
        </div>
      </div>
    </div>
  );
}

