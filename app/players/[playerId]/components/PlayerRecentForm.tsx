interface PlayerRecentFormProps {
  recentForm: {
    last_5?: {
      avg_points?: number;
      avg_rebounds?: number;
      avg_assists?: number;
      fg_pct?: number;
      avg_minutes?: number;
    };
    last_10?: {
      avg_points?: number;
      avg_rebounds?: number;
      avg_assists?: number;
      fg_pct?: number;
      avg_minutes?: number;
    };
  };
}

export function PlayerRecentForm({ recentForm }: PlayerRecentFormProps) {
  const l5 = recentForm.last_5 || {};
  const l10 = recentForm.last_10 || {};

  if (!l5.avg_points && !l10.avg_points) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Recent Form
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            Last 5 Games
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Points</div>
              <div className="text-xl font-bold">
                {l5.avg_points ? Number(l5.avg_points).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Rebounds</div>
              <div className="text-xl font-bold">
                {l5.avg_rebounds ? Number(l5.avg_rebounds).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Assists</div>
              <div className="text-xl font-bold">
                {l5.avg_assists ? Number(l5.avg_assists).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">FG%</div>
              <div className="text-xl font-bold">
                {l5.fg_pct ? Number(l5.fg_pct).toFixed(1) + '%' : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Minutes</div>
              <div className="text-xl font-bold">
                {l5.avg_minutes ? Number(l5.avg_minutes).toFixed(1) : '-'}
              </div>
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            Last 10 Games
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Points</div>
              <div className="text-xl font-bold">
                {l10.avg_points ? Number(l10.avg_points).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Rebounds</div>
              <div className="text-xl font-bold">
                {l10.avg_rebounds ? Number(l10.avg_rebounds).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Assists</div>
              <div className="text-xl font-bold">
                {l10.avg_assists ? Number(l10.avg_assists).toFixed(1) : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">FG%</div>
              <div className="text-xl font-bold">
                {l10.fg_pct ? Number(l10.fg_pct).toFixed(1) + '%' : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Minutes</div>
              <div className="text-xl font-bold">
                {l10.avg_minutes ? Number(l10.avg_minutes).toFixed(1) : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

