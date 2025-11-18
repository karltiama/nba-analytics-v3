import { query } from '@/lib/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';

interface StatusUpdate {
  game_id: string;
  old_status: string | null;
  new_status: string;
  reason: string;
}

async function getInvalidStatusGames() {
  return await query(`
    SELECT 
      g.game_id,
      g.status,
      g.start_time,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status IS NULL 
       OR g.status NOT IN ('Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled')
    ORDER BY g.start_time DESC
    LIMIT 100
  `);
}

async function getStatusDistribution() {
  return await query(`
    SELECT 
      status,
      COUNT(*) as count
    FROM games
    GROUP BY status
    ORDER BY count DESC
  `);
}

async function updateStatus(formData: FormData) {
  'use server';
  
  const gameId = formData.get('game_id') as string;
  const newStatus = formData.get('new_status') as string;
  
  if (!gameId || !newStatus) {
    return;
  }

  await query(
    `UPDATE games SET status = $1, updated_at = now() WHERE game_id = $2`,
    [newStatus, gameId]
  );

  redirect('/admin/game-statuses?updated=1');
}

export default async function GameStatusesPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const { updated } = await searchParams;
  const [invalidGames, statusDistribution] = await Promise.all([
    getInvalidStatusGames(),
    getStatusDistribution(),
  ]);

  const VALID_STATUSES = ['Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled'];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
              Game Status Management
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Fix incorrectly formatted game statuses
            </p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/admin/data-dump"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              ← Data Dump
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-zinc-50"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {updated && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-green-800 dark:text-green-200">
              ✅ Status updated successfully!
            </p>
          </div>
        )}

        {/* Status Distribution */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Current Status Distribution
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {statusDistribution.map((stat: any) => {
              const isValid = VALID_STATUSES.includes(stat.status);
              return (
                <div
                  key={stat.status || '(null)'}
                  className={`p-4 rounded-lg ${
                    isValid
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                      : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                  }`}
                >
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    {stat.status || '(null)'}
                  </div>
                  <div className="text-2xl font-bold text-black dark:text-zinc-50">
                    {stat.count.toLocaleString()}
                  </div>
                  {!isValid && (
                    <div className="text-xs text-yellow-800 dark:text-yellow-200 mt-1">
                      Invalid
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Invalid Status Games */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
            Games with Invalid Statuses ({invalidGames.length})
          </h2>
          {invalidGames.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">
              ✅ All game statuses are valid!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Date</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Game</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Current Status</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Score</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Suggested Status</th>
                    <th className="text-left py-2 px-4 text-zinc-600 dark:text-zinc-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidGames.map((game: any) => {
                    const hasScores = game.home_score !== null && game.away_score !== null;
                    const isPast = new Date(game.start_time) < new Date();
                    const suggestedStatus = hasScores || isPast ? 'Final' : 'Scheduled';

                    return (
                      <tr
                        key={game.game_id}
                        className="border-b border-zinc-100 dark:border-zinc-900"
                      >
                        <td className="py-2 px-4 text-black dark:text-zinc-50">
                          {new Date(game.start_time).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-4">
                          <Link
                            href={`/games/${game.game_id}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {game.away_abbr} @ {game.home_abbr}
                          </Link>
                        </td>
                        <td className="py-2 px-4">
                          <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                            {game.status || '(null)'}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-black dark:text-zinc-50">
                          {hasScores
                            ? `${game.away_score} - ${game.home_score}`
                            : '-'}
                        </td>
                        <td className="py-2 px-4">
                          <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            {suggestedStatus}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          <form action={updateStatus} className="inline">
                            <input type="hidden" name="game_id" value={game.game_id} />
                            <input type="hidden" name="new_status" value={suggestedStatus} />
                            <button
                              type="submit"
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Update to {suggestedStatus}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bulk Fix Option */}
        {invalidGames.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-6">
            <h2 className="text-xl font-semibold text-black dark:text-zinc-50 mb-2">
              Bulk Fix Option
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              To fix all invalid statuses at once, run:
            </p>
            <code className="block bg-zinc-900 text-green-400 p-4 rounded-lg font-mono text-sm">
              npx tsx scripts/fix-game-statuses.ts
            </code>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Use <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded">--dry-run</code> to preview changes first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

