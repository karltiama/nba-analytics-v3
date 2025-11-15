interface QuarterStrengthsProps {
  quarterStrengths: {
    q1?: { avg_ppg?: number | null; rank?: number | null };
    q2?: { avg_ppg?: number | null; rank?: number | null };
    q3?: { avg_ppg?: number | null; rank?: number | null };
    q4?: { avg_ppg?: number | null; rank?: number | null };
  };
}

export function QuarterStrengths({ quarterStrengths }: QuarterStrengthsProps) {
  const hasData = 
    (quarterStrengths.q1?.avg_ppg != null) || 
    (quarterStrengths.q2?.avg_ppg != null) || 
    (quarterStrengths.q3?.avg_ppg != null) || 
    (quarterStrengths.q4?.avg_ppg != null);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Quarter Strengths
      </h2>
      {hasData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['q1', 'q2', 'q3', 'q4'].map((quarter) => {
            const q = quarterStrengths[quarter as keyof typeof quarterStrengths];
            return (
              <div key={quarter} className="text-center">
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">
                  {quarter.toUpperCase()}
                </div>
                <div className="text-xl font-bold">
                  {q?.avg_ppg != null ? Number(q.avg_ppg).toFixed(1) : '-'} PPG
                </div>
                <div className="text-xs text-zinc-500">
                  Rank: {q?.rank ? `#${q.rank}` : '-'}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          Quarter-by-quarter data is not available yet. This data will be populated once quarter scores are added to the database.
        </p>
      )}
    </div>
  );
}

