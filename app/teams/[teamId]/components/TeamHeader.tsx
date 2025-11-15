import Link from 'next/link';

interface TeamHeaderProps {
  team: {
    full_name: string;
    conference?: string | null;
    division?: string | null;
  };
}

export function TeamHeader({ team }: TeamHeaderProps) {
  return (
    <div>
      <Link
        href="/games"
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
      >
        ← Back to Games
      </Link>
      <h1 className="text-4xl font-bold text-black dark:text-zinc-50 mb-2">
        {team.full_name}
      </h1>
      {team.conference && team.division && (
        <p className="text-zinc-600 dark:text-zinc-400">
          {team.conference}ern Conference • {team.division} Division
        </p>
      )}
    </div>
  );
}

