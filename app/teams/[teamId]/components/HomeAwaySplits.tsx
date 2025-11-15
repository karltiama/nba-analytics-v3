interface HomeAwaySplitsProps {
  splits: {
    home?: {
      games_played?: number;
      points_for?: number;
      points_against?: number;
      scoring_differential?: number;
    };
    away?: {
      games_played?: number;
      points_for?: number;
      points_against?: number;
      scoring_differential?: number;
    };
  };
}

export function HomeAwaySplits({ splits }: HomeAwaySplitsProps) {
  if (!splits.home?.games_played && !splits.away?.games_played) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Home/Away Splits
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Home</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Games: </span>
              <span className="font-medium">{splits.home?.games_played || 0}</span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">PPG: </span>
              <span className="font-medium">
                {splits.home?.points_for ? Number(splits.home.points_for).toFixed(1) : '-'}
              </span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Pts Allowed: </span>
              <span className="font-medium">
                {splits.home?.points_against ? Number(splits.home.points_against).toFixed(1) : '-'}
              </span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Diff: </span>
              <span className={`font-medium ${
                (splits.home?.scoring_differential || 0) > 0 ? 'text-green-600' : 
                (splits.home?.scoring_differential || 0) < 0 ? 'text-red-600' : ''
              }`}>
                {splits.home?.scoring_differential 
                  ? (Number(splits.home.scoring_differential) > 0 ? '+' : '') + Number(splits.home.scoring_differential).toFixed(1)
                  : '-'}
              </span>
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-2">Away</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Games: </span>
              <span className="font-medium">{splits.away?.games_played || 0}</span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">PPG: </span>
              <span className="font-medium">
                {splits.away?.points_for ? Number(splits.away.points_for).toFixed(1) : '-'}
              </span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Pts Allowed: </span>
              <span className="font-medium">
                {splits.away?.points_against ? Number(splits.away.points_against).toFixed(1) : '-'}
              </span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Diff: </span>
              <span className={`font-medium ${
                (splits.away?.scoring_differential || 0) > 0 ? 'text-green-600' : 
                (splits.away?.scoring_differential || 0) < 0 ? 'text-red-600' : ''
              }`}>
                {splits.away?.scoring_differential 
                  ? (Number(splits.away.scoring_differential) > 0 ? '+' : '') + Number(splits.away.scoring_differential).toFixed(1)
                  : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

