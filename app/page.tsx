import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-4xl flex-col items-center justify-center py-32 px-16">
        <div className="flex flex-col items-center gap-8 text-center">
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-black dark:text-zinc-50">
            NBA Analytics
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Explore game results, player statistics, and team performance data
            from the 2025-26 NBA season.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Link
              href="/dashboard"
              className="flex h-12 items-center justify-center rounded-full bg-black px-8 text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              View Dashboard
            </Link>
            <Link
              href="/games"
              className="flex h-12 items-center justify-center rounded-full border border-zinc-300 bg-white px-8 text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              Browse Games
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
