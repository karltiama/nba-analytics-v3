import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { query } from '@/lib/db';

async function getGameBoxScore(gameId: string) {
  const game = await query(`
    select 
      g.game_id,
      g.season,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      g.venue,
      ht.team_id as home_team_id,
      ht.abbreviation as home_team_abbr,
      ht.full_name as home_team_name,
      at.team_id as away_team_id,
      at.abbreviation as away_team_abbr,
      at.full_name as away_team_name
    from games g
    join teams ht on g.home_team_id = ht.team_id
    join teams at on g.away_team_id = at.team_id
    where g.game_id = $1
  `, [gameId]);

  if (game.length === 0) {
    return null;
  }

  // Get box score - check both the game_id directly and any related game IDs from provider mappings
  // This handles cases where games are stored with BDL IDs but box scores use NBA Stats IDs
  const boxscore = await query(`
    with related_game_ids as (
      -- If game_id matches an internal_id, get all provider_ids for that internal_id
      select distinct provider_id as game_id
      from provider_id_map
      where entity_type = 'game' and internal_id = $1
      union
      -- If game_id matches a provider_id, get the internal_id
      select distinct internal_id as game_id
      from provider_id_map
      where entity_type = 'game' and provider_id = $1
      union
      -- Also include the original game_id itself
      select $1::text as game_id
    )
    select 
      pgs.*,
      p.full_name as player_name,
      t.abbreviation as team_abbr,
      t.team_id
    from player_game_stats pgs
    join players p on pgs.player_id = p.player_id
    join teams t on pgs.team_id = t.team_id
    join related_game_ids rgi on pgs.game_id = rgi.game_id
    order by t.team_id, pgs.points desc nulls last
  `, [gameId]);

  return {
    game: game[0],
    boxscore,
  };
}

export default async function GameBoxScorePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const data = await getGameBoxScore(gameId);

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Game not found</h1>
          <Link href="/games" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Games
          </Link>
        </div>
      </div>
    );
  }

  const { game, boxscore } = data;
  const homeTeamStats = boxscore.filter((s: any) => s.team_id === game.home_team_id);
  const awayTeamStats = boxscore.filter((s: any) => s.team_id === game.away_team_id);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href="/games"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
          >
            ← Back to Games
          </Link>
          <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
            Box Score
          </h1>
          <div className="text-lg text-zinc-600 dark:text-zinc-400">
            <p>
              <Link
                href={`/teams/${game.away_team_id}`}
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              >
                {game.away_team_name}
              </Link>
              {' @ '}
              <Link
                href={`/teams/${game.home_team_id}`}
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              >
                {game.home_team_name}
              </Link>
            </p>
            <p>
              {new Date(game.start_time).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
            {game.home_score !== null && game.away_score !== null && (
              <p className="text-2xl font-bold text-black dark:text-zinc-50 mt-2">
                {game.away_score} - {game.home_score}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Away Team */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold mb-4">
              <Link
                href={`/teams/${game.away_team_id}`}
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              >
                {game.away_team_name}
              </Link>
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>MIN</TableHead>
                    <TableHead>PTS</TableHead>
                    <TableHead>REB</TableHead>
                    <TableHead>AST</TableHead>
                    <TableHead>STL</TableHead>
                    <TableHead>BLK</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {awayTeamStats.map((stat: any) => (
                    <TableRow key={`${stat.game_id}-${stat.player_id}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/players/${stat.player_id}`}
                          className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          {stat.player_name}
                        </Link>
                      </TableCell>
                      <TableCell>{stat.minutes ? Number(stat.minutes).toFixed(1) : '-'}</TableCell>
                      <TableCell>{stat.points ?? '-'}</TableCell>
                      <TableCell>{stat.rebounds ?? '-'}</TableCell>
                      <TableCell>{stat.assists ?? '-'}</TableCell>
                      <TableCell>{stat.steals ?? '-'}</TableCell>
                      <TableCell>{stat.blocks ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Home Team */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-2xl font-semibold mb-4">
              <Link
                href={`/teams/${game.home_team_id}`}
                className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              >
                {game.home_team_name}
              </Link>
            </h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>MIN</TableHead>
                    <TableHead>PTS</TableHead>
                    <TableHead>REB</TableHead>
                    <TableHead>AST</TableHead>
                    <TableHead>STL</TableHead>
                    <TableHead>BLK</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {homeTeamStats.map((stat: any) => (
                    <TableRow key={`${stat.game_id}-${stat.player_id}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/players/${stat.player_id}`}
                          className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          {stat.player_name}
                        </Link>
                      </TableCell>
                      <TableCell>{stat.minutes ? Number(stat.minutes).toFixed(1) : '-'}</TableCell>
                      <TableCell>{stat.points ?? '-'}</TableCell>
                      <TableCell>{stat.rebounds ?? '-'}</TableCell>
                      <TableCell>{stat.assists ?? '-'}</TableCell>
                      <TableCell>{stat.steals ?? '-'}</TableCell>
                      <TableCell>{stat.blocks ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

