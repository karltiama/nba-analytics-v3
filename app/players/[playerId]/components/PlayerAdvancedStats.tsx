interface PlayerAdvancedStatsProps {
  seasonStats: {
    efg_pct?: number;
    ts_pct?: number;
  };
  paceAdjusted: {
    points_per_100?: number;
    rebounds_per_100?: number;
    assists_per_100?: number;
    points_per_36?: number;
    rebounds_per_36?: number;
    assists_per_36?: number;
  };
  usageRate: {
    usage_rate?: number;
  };
}

export function PlayerAdvancedStats({ 
  seasonStats, 
  paceAdjusted, 
  usageRate 
}: PlayerAdvancedStatsProps) {
  const hasData = seasonStats.efg_pct || seasonStats.ts_pct || paceAdjusted.points_per_100 || usageRate.usage_rate;

  if (!hasData) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Advanced Statistics
      </h2>
      
      {/* Efficiency Metrics */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
          Efficiency Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {seasonStats.ts_pct !== null && seasonStats.ts_pct !== undefined && (
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">True Shooting %</div>
              <div className="text-xl font-bold">
                {Number(seasonStats.ts_pct).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Accounts for 3s & FTs
              </div>
            </div>
          )}
          {seasonStats.efg_pct !== null && seasonStats.efg_pct !== undefined && (
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Effective FG%</div>
              <div className="text-xl font-bold">
                {Number(seasonStats.efg_pct).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Accounts for 3s
              </div>
            </div>
          )}
          {usageRate.usage_rate !== null && usageRate.usage_rate !== undefined && (
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Usage Rate</div>
              <div className="text-xl font-bold">
                {Number(usageRate.usage_rate).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                % of team possessions
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pace-Adjusted Stats */}
      {(paceAdjusted.points_per_100 || paceAdjusted.points_per_36) && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            Pace-Adjusted Stats
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {paceAdjusted.points_per_100 !== null && paceAdjusted.points_per_100 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Points per 100</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.points_per_100).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 100 possessions
                </div>
              </div>
            )}
            {paceAdjusted.rebounds_per_100 !== null && paceAdjusted.rebounds_per_100 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Rebounds per 100</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.rebounds_per_100).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 100 possessions
                </div>
              </div>
            )}
            {paceAdjusted.assists_per_100 !== null && paceAdjusted.assists_per_100 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Assists per 100</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.assists_per_100).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 100 possessions
                </div>
              </div>
            )}
            {paceAdjusted.points_per_36 !== null && paceAdjusted.points_per_36 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Points per 36</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.points_per_36).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 36 minutes
                </div>
              </div>
            )}
            {paceAdjusted.rebounds_per_36 !== null && paceAdjusted.rebounds_per_36 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Rebounds per 36</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.rebounds_per_36).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 36 minutes
                </div>
              </div>
            )}
            {paceAdjusted.assists_per_36 !== null && paceAdjusted.assists_per_36 !== undefined && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Assists per 36</div>
                <div className="text-xl font-bold">
                  {Number(paceAdjusted.assists_per_36).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Per 36 minutes
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

