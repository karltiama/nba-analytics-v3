import Link from 'next/link';
import type { PlayerProfile, SeasonAverages } from '@/lib/players/types';

export interface PlayerTeamInfo {
  team_id: string;
  abbreviation: string;
  full_name: string;
}

interface PlayerHeaderProps {
  player: PlayerProfile;
  seasonAverages?: SeasonAverages;
  /** Current team (e.g. from most recent game). When set, shows team logo and link to team page. */
  team?: PlayerTeamInfo | null;
  /** Optional player headshot URL. When missing, initials are shown. */
  headshotUrl?: string | null;
}

export function PlayerHeader({ player, seasonAverages, team, headshotUrl }: PlayerHeaderProps) {
  const gp = seasonAverages?.games_active ?? seasonAverages?.games_played;
  const initials = player.full_name.split(' ').map(n => n[0]).join('');

  return (
    <div className="glass-card rounded-xl border-l-4 border-l-[#00d4ff] card-hover overflow-hidden">
      {/* Top bar matching GameCard header zone */}
      <div className="px-5 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <Link
          href="/betting"
          className="text-xs font-medium text-[#00d4ff] hover:underline inline-flex items-center gap-1.5 transition-colors"
        >
          &larr; Betting Dashboard
        </Link>
        <div className="flex items-center gap-2">
          {player.active !== null && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-1.5 h-1.5 rounded-full ${player.active ? 'bg-[#39ff14] pulse-dot' : 'bg-zinc-500'}`} />
              {player.active ? 'Active' : 'Inactive'}
            </span>
          )}
          {player.position && (
            <span className="text-[10px] px-2 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full font-semibold">
              {player.position}
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="p-5">
        <div className="flex flex-col items-center md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col items-center md:flex-row md:items-center gap-4">
            {/* Player headshot or initials */}
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 overflow-hidden flex-shrink-0">
              {headshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={headshotUrl}
                  alt={player.full_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-lg font-bold text-white/50">{initials}</span>
              )}
            </div>
            <div className="min-w-0 text-center md:text-left">
              <h1 className="text-2xl font-bold text-white">
                {player.full_name}
              </h1>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs text-muted-foreground mt-0.5">
                {player.height && <span>{player.height}</span>}
                {player.height && player.weight && <span className="text-white/20">•</span>}
                {player.weight && <span>{player.weight} lbs</span>}
              </div>
              {/* Team logo + link to team page */}
              {team && (
                <Link
                  href={`/teams/${team.team_id}`}
                  className="inline-flex items-center justify-center md:justify-start gap-2 mt-2 text-xs text-muted-foreground hover:text-[#00d4ff] transition-colors"
                >
                  <span className="w-7 h-7 rounded-md bg-white/10 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/80">
                    {team.abbreviation}
                  </span>
                  <span>{team.full_name}</span>
                </Link>
              )}
            </div>
          </div>

          {seasonAverages && gp && gp > 0 && (
            <div className="flex gap-3">
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
    <div className="text-center px-3 py-2 rounded-lg bg-white/5 border border-white/5">
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
