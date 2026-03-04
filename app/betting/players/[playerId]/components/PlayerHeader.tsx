import Link from 'next/link';
import type { PlayerProfile, SeasonAverages } from '@/lib/players/types';

interface PlayerHeaderProps {
  player: PlayerProfile;
  seasonAverages?: SeasonAverages;
}

export function PlayerHeader({ player, seasonAverages }: PlayerHeaderProps) {
  const gp = seasonAverages?.games_active ?? seasonAverages?.games_played;

  return (
    <div className="space-y-4">
      <Link
        href="/betting"
        className="text-sm text-[#00d4ff] hover:underline inline-flex items-center gap-1"
      >
        &larr; Back to Betting Dashboard
      </Link>

      <div className="glass-card rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">
              {player.full_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {player.position && (
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium">
                  {player.position}
                </span>
              )}
              {player.height && <span>{player.height}</span>}
              {player.weight && <span>{player.weight} lbs</span>}
              {player.active !== null && (
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${player.active ? 'bg-[#39ff14] pulse-dot' : 'bg-zinc-500'}`} />
                  {player.active ? 'Active' : 'Inactive'}
                </span>
              )}
            </div>
          </div>

          {seasonAverages && gp && gp > 0 && (
            <div className="flex gap-4">
              <QuickStat label="PPG" value={seasonAverages.avg_points} color="#00d4ff" />
              <QuickStat label="RPG" value={seasonAverages.avg_rebounds} color="#bf5af2" />
              <QuickStat label="APG" value={seasonAverages.avg_assists} color="#ff6b35" />
              <QuickStat label="GP" value={gp} decimals={0} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  decimals = 1,
  color,
}: {
  label: string;
  value?: number;
  decimals?: number;
  color?: string;
}) {
  if (value == null) return null;
  return (
    <div className="text-center px-3 py-2 rounded-lg bg-white/5">
      <div
        className="text-2xl font-bold font-mono"
        style={color ? { color } : undefined}
      >
        {Number(value).toFixed(decimals)}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
    </div>
  );
}
