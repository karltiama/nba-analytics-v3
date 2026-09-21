import { readFileSync } from 'fs';

const p = JSON.parse(
  readFileSync('content/preseason/2026/WAS.research.json', 'utf8')
);
console.log(
  'returningCore',
  p.roster.returningCore.map((r: { displayName: string }) => r.displayName)
);
console.log(
  'additions',
  p.roster.additions.map(
    (r: {
      displayName: string;
      otherTeamAbbr: string | null;
      requiresHumanRosterReview: boolean;
    }) =>
      `${r.displayName} from=${r.otherTeamAbbr} review=${r.requiresHumanRosterReview}`
  )
);
const signals = p.contextSignals.filter(
  (s: { displayName: string }) => /Davis/i.test(s.displayName)
);
console.log('Davis signals', signals);
