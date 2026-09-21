import type { Metadata } from 'next';
import Link from 'next/link';
import { listPreseasonDrafts } from '@/lib/teams/preseason-preview/automation/storage';

export const metadata: Metadata = {
  title: 'Preseason Preview Drafts',
  description: 'Internal review of automated Team Preseason Preview drafts.',
  robots: { index: false, follow: false },
};

const SEASON = '2026';

/** Static team list for generation status — not a CMS. */
const TEAMS: Array<{ slug: string; name: string }> = [
  { slug: 'ATL', name: 'Atlanta Hawks' },
  { slug: 'BOS', name: 'Boston Celtics' },
  { slug: 'BKN', name: 'Brooklyn Nets' },
  { slug: 'CHA', name: 'Charlotte Hornets' },
  { slug: 'CHI', name: 'Chicago Bulls' },
  { slug: 'CLE', name: 'Cleveland Cavaliers' },
  { slug: 'DAL', name: 'Dallas Mavericks' },
  { slug: 'DEN', name: 'Denver Nuggets' },
  { slug: 'DET', name: 'Detroit Pistons' },
  { slug: 'GSW', name: 'Golden State Warriors' },
  { slug: 'HOU', name: 'Houston Rockets' },
  { slug: 'IND', name: 'Indiana Pacers' },
  { slug: 'LAC', name: 'LA Clippers' },
  { slug: 'LAL', name: 'Los Angeles Lakers' },
  { slug: 'MEM', name: 'Memphis Grizzlies' },
  { slug: 'MIA', name: 'Miami Heat' },
  { slug: 'MIL', name: 'Milwaukee Bucks' },
  { slug: 'MIN', name: 'Minnesota Timberwolves' },
  { slug: 'NOP', name: 'New Orleans Pelicans' },
  { slug: 'NYK', name: 'New York Knicks' },
  { slug: 'OKC', name: 'Oklahoma City Thunder' },
  { slug: 'ORL', name: 'Orlando Magic' },
  { slug: 'PHI', name: 'Philadelphia 76ers' },
  { slug: 'PHX', name: 'Phoenix Suns' },
  { slug: 'POR', name: 'Portland Trail Blazers' },
  { slug: 'SAC', name: 'Sacramento Kings' },
  { slug: 'SAS', name: 'San Antonio Spurs' },
  { slug: 'TOR', name: 'Toronto Raptors' },
  { slug: 'UTA', name: 'Utah Jazz' },
  { slug: 'WAS', name: 'Washington Wizards' },
];

export default async function PreseasonContentAdminPage() {
  const drafts = await listPreseasonDrafts(SEASON);
  const bySlug = new Map(drafts.map((d) => [d.slug.toUpperCase(), d]));

  return (
    <main className="min-h-screen bg-background gradient-mesh">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Internal · preseason drafts · not indexed
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Preseason Preview Drafts
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Read-only review of automated drafts under content/preseason/
            {SEASON}. Public pages still use curated modules until a human
            promotes a draft. Scope: Facts / Signals / Generated / Warnings
            only.
          </p>
        </header>

        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Generation</th>
                <th className="px-3 py-2 font-medium">Warnings</th>
                <th className="px-3 py-2 font-medium">Review</th>
                <th className="px-3 py-2 font-medium">Last generated</th>
              </tr>
            </thead>
            <tbody>
              {TEAMS.map((team) => {
                const row = bySlug.get(team.slug);
                const generated = Boolean(row?.generated);
                return (
                  <tr
                    key={team.slug}
                    className="border-t border-white/5 text-white/90"
                  >
                    <td className="px-3 py-2">
                      {generated ? (
                        <Link
                          href={`/admin/content/preseason/${team.slug}`}
                          className="text-sky-300 hover:underline"
                        >
                          {team.name}
                        </Link>
                      ) : (
                        team.name
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {generated ? 'Generated' : 'Not generated'}
                    </td>
                    <td className="px-3 py-2">{row?.warningCount ?? '—'}</td>
                    <td className="px-3 py-2">{row?.reviewStatus ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row?.generatedAt ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
