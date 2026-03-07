import Link from 'next/link';
import { query } from '@/lib/db';

interface TeamRosterProps {
  teamId: string;
  season?: string | null;
}

interface RosterPlayer {
  player_id: string;
  full_name: string;
  position: string | null;
  games_played: number;
}

export async function TeamRoster({ teamId, season }: TeamRosterProps) {
  const currentSeason = season || '2025';

  const roster = await query<RosterPlayer>(`
    SELECT
      p.player_id,
      p.full_name,
      p.position,
      count(*)::int as games_played
    FROM analytics.player_game_logs pgl
    JOIN analytics.players p ON p.player_id = pgl.player_id
    WHERE pgl.team_id = $1
      AND pgl.season = $2
    GROUP BY p.player_id, p.full_name, p.position
    ORDER BY count(*) DESC, p.full_name ASC
  `, [teamId, currentSeason]);

  if (!roster || roster.length === 0) {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">No roster data available.</p>
      </div>
    );
  }

  const guards = roster.filter(p => p.position && ['G', 'PG', 'SG'].includes(p.position));
  const forwards = roster.filter(p => p.position && ['F', 'PF', 'SF'].includes(p.position));
  const centers = roster.filter(p => p.position && ['C'].includes(p.position));
  const others = roster.filter(p => !p.position || !['G', 'PG', 'SG', 'F', 'PF', 'SF', 'C'].includes(p.position));

  const positionGroups = [
    { name: 'Guards', players: guards },
    { name: 'Forwards', players: forwards },
    { name: 'Centers', players: centers },
    { name: 'Other', players: others },
  ].filter(group => group.players.length > 0);

  return (
    <div className="glass-card rounded-xl overflow-hidden flex flex-col min-h-0 xl:min-h-[calc(100vh-10rem)]">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02] shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roster
        </h3>
        <span className="text-[10px] px-2 py-0.5 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
          {roster.length}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {positionGroups.map((group) => (
          <div key={group.name}>
            <div className="px-4 py-1.5 bg-white/[0.03] border-b border-white/5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group.name}
              </span>
            </div>
            {group.players.map((player) => (
              <Link
                key={player.player_id}
                href={`/betting/players/${player.player_id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors border-b border-white/[0.03] group"
              >
                <span className="w-6 text-center text-xs font-mono text-muted-foreground">
                  {player.games_played}g
                </span>
                <span className="flex-1 text-sm text-white group-hover:text-[#00d4ff] transition-colors truncate">
                  {player.full_name}
                </span>
                <span className="text-[10px] text-muted-foreground/60 font-medium">
                  {player.position || ''}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
