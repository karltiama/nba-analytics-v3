import 'dotenv/config';
import { readFileSync } from 'fs';

for (const team of ['PHI', 'MIN', 'BOS', 'WAS', 'MEM']) {
  const p = JSON.parse(
    readFileSync(`content/preseason/2026/${team}.research.json`, 'utf8')
  );
  console.log('\n===', team, '===');
  for (const d of p.roster.departures) {
    const s = p.playerSeasonStats.find(
      (x: { playerEntityId: string }) => x.playerEntityId === d.playerEntityId
    );
    console.log(
      `DEP ${d.displayName}→${d.otherTeamAbbr} review=${d.requiresHumanRosterReview} reasons=${(d.reviewReasons || []).join('+') || '-'} mpg=${s?.mpg ?? 'null'} ppg=${s?.ppg ?? 'null'} usg=${s?.usageAvg ?? 'null'}`
    );
  }
}
