import Link from 'next/link';
import { query } from '@/lib/db';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TeamRosterProps {
  teamId: string;
  season?: string | null;
}

interface RosterPlayer {
  player_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  height: string | null;
  weight: string | null;
  jersey: string | null;
  active: boolean | null;
}

export async function TeamRoster({ teamId, season }: TeamRosterProps) {
  // If season not provided, find the most recent season available for this team
  let currentSeason = season;
  
  if (!currentSeason) {
    const seasonResult = await query<{ season: string }>(`
      SELECT season
      FROM player_team_rosters
      WHERE team_id = $1
      ORDER BY season DESC
      LIMIT 1
    `, [teamId]);
    
    if (seasonResult.length > 0) {
      currentSeason = seasonResult[0].season;
    } else {
      // Fallback to common season formats
      currentSeason = '2025';
    }
  }

  const roster = await query<RosterPlayer>(`
    SELECT 
      p.player_id,
      p.full_name,
      p.first_name,
      p.last_name,
      p.position,
      p.height,
      p.weight,
      ptr.jersey,
      ptr.active
    FROM player_team_rosters ptr
    JOIN players p ON ptr.player_id = p.player_id
    WHERE ptr.team_id = $1
      AND ptr.season = $2
    ORDER BY 
      CASE 
        WHEN ptr.jersey ~ '^[0-9]+$' THEN ptr.jersey::integer
        ELSE 999
      END ASC,
      p.last_name ASC NULLS LAST,
      p.first_name ASC NULLS LAST
  `, [teamId, currentSeason]);

  if (!roster || roster.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
          Roster
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          No roster data available for this season.
        </p>
      </div>
    );
  }

  // Group players by position
  const guards = roster.filter(p => p.position && ['G', 'PG', 'SG'].includes(p.position));
  const forwards = roster.filter(p => p.position && ['F', 'PF', 'SF'].includes(p.position));
  const centers = roster.filter(p => p.position && ['C'].includes(p.position));
  const others = roster.filter(p => !p.position || (!['G', 'PG', 'SG', 'F', 'PF', 'SF', 'C'].includes(p.position)));

  const positionGroups = [
    { name: 'Guards', players: guards, abbr: 'G' },
    { name: 'Forwards', players: forwards, abbr: 'F' },
    { name: 'Centers', players: centers, abbr: 'C' },
    { name: 'Others', players: others, abbr: null },
  ].filter(group => group.players.length > 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Roster ({roster.length} players)
      </h2>

      <div className="space-y-6">
        {positionGroups.map((group) => (
          <div key={group.name}>
            <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
              {group.name} ({group.players.length})
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Height</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.players.map((player) => (
                  <TableRow key={player.player_id}>
                    <TableCell className="font-medium">
                      {player.jersey || '-'}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/players/${player.player_id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {player.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {player.position || '-'}
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {player.height || '-'}
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {player.weight ? `${player.weight} lbs` : '-'}
                    </TableCell>
                    <TableCell>
                      {player.active !== null && (
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            player.active
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                          }`}
                        >
                          {player.active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );
}

