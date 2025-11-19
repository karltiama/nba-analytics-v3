import Link from 'next/link';

interface PlayerHeaderProps {
  player: {
    player_id: string;
    full_name: string;
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    height?: string | null;
    weight?: string | null;
    dob?: string | null;
    active?: boolean | null;
  };
}

export function PlayerHeader({ player }: PlayerHeaderProps) {
  return (
    <div>
      <Link
        href="/dashboard"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
      >
        ← Back to Dashboard
      </Link>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
            {player.full_name}
          </h1>
          <div className="flex flex-wrap gap-4 text-zinc-600 dark:text-zinc-400">
            {player.position && (
              <span>Position: {player.position}</span>
            )}
            {player.height && (
              <span>Height: {player.height}</span>
            )}
            {player.weight && (
              <span>Weight: {player.weight}</span>
            )}
            {player.dob && (
              <span>DOB: {new Date(player.dob).toLocaleDateString()}</span>
            )}
            {player.active !== null && (
              <span className={player.active ? 'text-green-600 dark:text-green-400' : 'text-zinc-400'}>
                {player.active ? 'Active' : 'Inactive'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

