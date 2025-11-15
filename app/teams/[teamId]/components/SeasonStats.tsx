interface SeasonStatsProps {
  seasonStats: {
    games_played?: number;
    points_for?: number;
    points_against?: number;
    scoring_differential?: number;
    pace?: number;
    fg_pct?: number;
    three_pct?: number;
  };
  rankings: {
    offensive_rank?: number | null;
    defensive_rank?: number | null;
  };
}

export function SeasonStats({ seasonStats, rankings }: SeasonStatsProps) {
  if (!seasonStats.games_played || seasonStats.games_played === 0) {
    return null;
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
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Points For</div>
          <div className="text-2xl font-bold">
            {seasonStats.points_for ? Number(seasonStats.points_for).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Points Against</div>
          <div className="text-2xl font-bold">
            {seasonStats.points_against ? Number(seasonStats.points_against).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Scoring Differential</div>
          <div className={`text-2xl font-bold ${
            (seasonStats.scoring_differential || 0) > 0 
              ? 'text-green-600' 
              : (seasonStats.scoring_differential || 0) < 0 
              ? 'text-red-600' 
              : ''
          }`}>
            {seasonStats.scoring_differential 
              ? (Number(seasonStats.scoring_differential) > 0 ? '+' : '') + Number(seasonStats.scoring_differential).toFixed(1)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Pace</div>
          <div className="text-2xl font-bold">
            {seasonStats.pace ? Number(seasonStats.pace).toFixed(1) : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">FG%</div>
          <div className="text-2xl font-bold">
            {seasonStats.fg_pct ? Number(seasonStats.fg_pct).toFixed(1) + '%' : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">3P%</div>
          <div className="text-2xl font-bold">
            {seasonStats.three_pct ? Number(seasonStats.three_pct).toFixed(1) + '%' : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Offensive Rank</div>
          <div className="text-2xl font-bold">
            {rankings.offensive_rank ? `#${rankings.offensive_rank}` : '-'}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Defensive Rank</div>
          <div className="text-2xl font-bold">
            {rankings.defensive_rank ? `#${rankings.defensive_rank}` : '-'}
          </div>
        </div>
      </div>
    </div>
  );
}

