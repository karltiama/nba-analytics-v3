'use client';

import type { PlayerRecentForm } from '@/lib/players/types';
import type { SeasonAverages } from '@/lib/players/types';

function fmt(value: number): string {
  return value.toFixed(1);
}

export interface PlayerRecentFormCardProps {
  recentForm: PlayerRecentForm | null;
  seasonAverages: SeasonAverages;
  seasonAvgMinutes: number | null;
}

export function PlayerRecentFormCard({
  recentForm,
  seasonAverages,
  seasonAvgMinutes,
}: PlayerRecentFormCardProps) {
  if (!recentForm || recentForm.games_played === 0) {
    return (
      <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4a6366] mb-3">
          Player Recent Form
        </h3>
        <p className="text-[#4a6366]">No recent games.</p>
      </section>
    );
  }

  const seasonPts = seasonAverages.avg_points ?? 0;
  const trend =
    seasonPts > 0
      ? recentForm.avg_pts > seasonPts
        ? 'up'
        : recentForm.avg_pts < seasonPts
          ? 'down'
          : null
      : null;

  return (
    <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4a6366] mb-3">
        Player Recent Form
      </h3>
      <p className="text-xs text-[#4a6366] mb-3">Last {recentForm.games_played} games</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div>
          <div className="text-[10px] text-[#4a6366] uppercase">PTS</div>
          <div className="text-lg font-bold font-mono text-[#063f46]">{fmt(recentForm.avg_pts)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#4a6366] uppercase">REB</div>
          <div className="text-lg font-bold font-mono text-[#063f46]">{fmt(recentForm.avg_reb)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#4a6366] uppercase">AST</div>
          <div className="text-lg font-bold font-mono text-[#063f46]">{fmt(recentForm.avg_ast)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#4a6366] uppercase">PRA</div>
          <div className="text-lg font-bold font-mono text-[#063f46]">{fmt(recentForm.avg_pra)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#4a6366] uppercase">MIN</div>
          <div className="text-lg font-bold font-mono text-[#063f46]">
            {recentForm.avg_minutes != null ? fmt(recentForm.avg_minutes) : '—'}
          </div>
          {seasonAvgMinutes != null && recentForm.avg_minutes != null && (
            <div className="text-[10px] text-[#4a6366] mt-0.5">
              vs {fmt(seasonAvgMinutes)} season
            </div>
          )}
        </div>
      </div>
      {trend && (
        <p className="text-xs text-[#4a6366] mt-2">
          Trending {trend} vs season avg ({fmt(seasonPts)} PTS).
        </p>
      )}
    </section>
  );
}
