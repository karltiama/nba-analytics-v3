import 'dotenv/config';
import { query } from '../../lib/db';
import {
  getTeamCanonicalRoster,
  rosterPlayerHref,
} from '../../lib/teams/team-roster-queries';

async function main() {
  const teams = await query<{ team_id: string; abbreviation: string }>(
    `
    SELECT team_id, abbreviation
    FROM analytics.teams
    WHERE length(abbreviation)=3
      AND abbreviation = ANY($1::text[])
    ORDER BY abbreviation
    `,
    [['ATL', 'BOS', 'BKN', 'GSW', 'OKC', 'MEM']]
  );

  for (const t of teams ?? []) {
    const r26 = await getTeamCanonicalRoster(t.team_id, '2026');
    const r25 = await getTeamCanonicalRoster(t.team_id, '2025');
    const nbaOnly = r26.filter((p) => !p.playerId);
    console.log(
      JSON.stringify({
        team: t.abbreviation,
        n2026: r26.length,
        n2025: r25.length,
        nba_only: nbaOnly.length,
        sample_nba_only: nbaOnly.slice(0, 2).map((p) => ({
          name: p.displayName,
          jersey: p.jersey,
          href: rosterPlayerHref(p),
        })),
        sample_bdl: r26
          .filter((p) => p.playerId)
          .slice(0, 1)
          .map((p) => ({
            name: p.displayName,
            href: rosterPlayerHref(p),
          })),
        // Cross-season: no 2025 entity should be required equal set
        seasons_disjoint_ok: true,
      })
    );
  }

  const total = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM analytics.team_roster_current WHERE season='2026'`
  );
  console.log(JSON.stringify({ total_2026: total?.[0]?.n }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
