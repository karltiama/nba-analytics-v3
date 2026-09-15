/**
 * Local check of bounded WOWY pair queries against serving data.
 * Does not write, ingest, or call paid endpoints.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '../nba-analytics-v3/.env') });
config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const { loadWowyPairSummary } = await import('../lib/wowy/queries');
  const result = await loadWowyPairSummary({
    subjectPlayerId: '246',
    teammatePlayerId: '335',
    season: '2024',
    teamId: '8',
    seasonType: 'regular',
  });
  if (!result.ok) {
    console.error(result);
    process.exit(1);
  }
  const s = result.summary;
  console.log(
    JSON.stringify(
      {
        subject: s.subject,
        teammate: s.teammate,
        withGames: s.with.gameCount,
        withoutGames: s.without.gameCount,
        unknownMembership: s.unknownMembershipCount,
        excluded: s.exclusions,
        withPts: s.with.perGame.pts,
        withoutPts: s.without.perGame.pts,
        withIds: s.with.gameIds.slice(0, 5),
        withoutIds: s.without.gameIds.slice(0, 5),
        support: s.support.tier,
      },
      null,
      2
    )
  );
  process.exit(0);
}

void main();
