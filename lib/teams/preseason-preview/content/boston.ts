import type { TeamPreseasonPreviewContent } from '../types';

/**
 * Boston Celtics — 2026–27 Team Preseason Preview (curated editorial).
 * Structured lists + prose only. Snapshot metrics come from live prior-season data when available.
 */
export const bostonPreseasonPreview: TeamPreseasonPreviewContent = {
  season: '2026',
  slug: 'BOS',
  teamId: '2',

  headline: 'Boston Celtics',
  dek: 'A new supporting cast around the same star.',

  bigPicture: [
    'Boston enters 2026–27 after a 56-win season and a first-round exit that made the offseason impossible to treat as business as usual. The franchise’s defining move was trading Jaylen Brown to Philadelphia for Paul George and a package of future picks — a bet that flexibility and frontcourt upgrading can outweigh the loss of a two-way star who had defined Boston’s identity for nearly a decade.',
    'Around Jayson Tatum, the supporting cast looks different: Mitchell Robinson and Mike Conley arrived in free agency to fortify the rim and the backcourt, Neemias Queta was extended as a long-term center piece, and the draft added Chris Cenac Jr. and Dillon Mitchell. Preseason is less about whether Boston can still win games and more about whether the new combinations can create reliable offense when defenses load up on Tatum — and whether the defense still travels without Brown’s size and competitiveness on the wing.',
  ],

  keyQuestions: [
    {
      headline: 'Who absorbs the creation Brown used to provide?',
      detail:
        'Tatum remains the fulcrum, but Brown’s on-ball gravity and transition finishing are gone. Watch whether Derrick White, Payton Pritchard, and Paul George can collectively replace that second-creation layer — especially in half-court sets where Boston previously leaned on Brown to break pressure.',
    },
    {
      headline: 'How do Queta and Robinson share the frontcourt?',
      detail:
        'Boston added elite rim protection in Mitchell Robinson while extending Neemias Queta. Preseason minutes, pick-and-roll coverage, and rebound splits will show whether this is a true timeshare, a starter/backup hierarchy, or a matchup-driven rotation that flexes night to night.',
    },
    {
      headline: 'Can Paul George stay available enough to matter in May?',
      detail:
        'George gives Boston scoring, size, and playmaking on paper. The real signal is availability and sustained defensive effort across an 82-game grind — not a strong October. Track load management patterns early; they preview how much Boston can count on him when the East tightens.',
    },
  ],

  additions: [
    {
      name: 'Paul George',
      nbaPlayerId: '202331',
      position: 'Forward',
      context: 'Wing scoring / secondary creation via Brown trade',
    },
    {
      name: 'Mitchell Robinson',
      nbaPlayerId: '1629011',
      position: 'Center',
      context: 'Rim protection / offensive rebounding',
    },
    {
      name: 'Mike Conley',
      nbaPlayerId: '201144',
      position: 'Guard',
      context: 'Veteran backcourt depth / half-court organization',
    },
  ],

  departures: [
    {
      name: 'Jaylen Brown',
      nbaPlayerId: '1627759',
      position: 'Wing',
      context: 'Two-way star creation / wing defense vacated',
    },
    {
      name: 'Nikola Vučević',
      nbaPlayerId: '202696',
      position: 'Center',
      context: 'Frontcourt scoring / size vacated',
    },
  ],

  draftPicks: [
    {
      name: 'Chris Cenac Jr.',
      nbaPlayerId: '1643416',
      position: 'Forward',
      context: 'No. 27 — size / developmental frontcourt upside',
    },
    {
      name: 'Dillon Mitchell',
      nbaPlayerId: '1641759',
      position: 'Forward',
      context: 'No. 40 — two-way wing depth',
    },
  ],

  projectedRotation: {
    starters: {
      PG: { name: 'Derrick White', nbaPlayerId: '1628401' },
      SG: { name: 'Payton Pritchard', nbaPlayerId: '1630202' },
      SF: { name: 'Jayson Tatum', nbaPlayerId: '1628369' },
      PF: { name: 'Paul George', nbaPlayerId: '202331' },
      C: { name: 'Neemias Queta', nbaPlayerId: '1629674' },
    },
    keyBench: [
      { name: 'Mitchell Robinson', nbaPlayerId: '1629011', position: 'C' },
      { name: 'Mike Conley', nbaPlayerId: '201144', position: 'G' },
      { name: 'Sam Hauser', nbaPlayerId: '1630573', position: 'F' },
      { name: 'Jordan Walsh', nbaPlayerId: '1641775', position: 'G/F' },
    ],
  },

  playersToWatch: [
    {
      name: 'Jayson Tatum',
      nbaPlayerId: '1628369',
      jerseyNumber: '0',
      position: 'SF',
      meta: "SF · 6'8\" · Age 28",
      watching:
        'Tatum’s role is stable as the primary creator, but the supporting cast changed. Watch how often he plays off-ball next to George, who finishes possessions when defenses blitz, and whether assist volume rises as Boston redistributes on-ball responsibility without Brown.',
    },
    {
      name: 'Paul George',
      nbaPlayerId: '202331',
      jerseyNumber: '8',
      position: 'PF',
      meta: "PF · 6'8\" · Age 36",
      watching:
        'The trade centerpiece on the roster side. Preseason is about chemistry with Tatum, shot diet in Boston’s spacing scheme, and whether he can hold up as a high-minute wing defender. Availability and decision-making under pressure matter more than early scoring spikes.',
    },
    {
      name: 'Payton Pritchard',
      nbaPlayerId: '1630202',
      jerseyNumber: '11',
      position: 'SG',
      meta: "SG · 6'1\" · Age 28",
      watching:
        'Brown’s departure opens more secondary creation and shot volume. Track on-ball reps, pull-up threes, and whether starting runway sticks once Conley and White compress the guard minutes. Pritchard’s decision-making with the second unit is a quiet lever for Boston’s offense.',
    },
  ],

  roleWatch: [
    {
      player: { name: 'Jayson Tatum', nbaPlayerId: '1628369' },
      previousRole: 'Primary creator',
      watch: 'Stable',
    },
    {
      player: { name: 'Derrick White', nbaPlayerId: '1628401' },
      previousRole: 'Two-way guard',
      watch: 'Opportunity ↑',
    },
    {
      player: { name: 'Payton Pritchard', nbaPlayerId: '1630202' },
      previousRole: 'Sixth Man / secondary guard',
      watch: 'Minutes ↑',
    },
    {
      player: { name: 'Paul George', nbaPlayerId: '202331' },
      previousRole: 'New to Boston',
      watch: 'Role TBD',
    },
    {
      player: { name: 'Neemias Queta', nbaPlayerId: '1629674' },
      previousRole: 'Starting center',
      watch: 'Competition ↑',
    },
    {
      player: { name: 'Mitchell Robinson', nbaPlayerId: '1629011' },
      previousRole: 'New to Boston',
      watch: 'Competition ↑',
    },
  ],

  wowyContext: [
    {
      title: 'When Tatum sits',
      detail:
        'Which teammates historically absorb minutes, usage, assists, or shot volume in games he misses? Treat prior with/without splits as descriptive history — especially useful now that Brown is gone and George/Conley change the second-unit map.',
    },
    {
      title: 'Frontcourt pairings',
      detail:
        'Monitor which big combinations (Queta, Robinson, and developmental size) share the floor most often in preseason. Court Context will later compare those pairings against historical participation and rim-protection splits where sample allows.',
    },
  ],

  outlook:
    "Boston's preseason is a chemistry problem first and a talent problem second. The ceiling still runs through Tatum; the open questions are whether George can stay on the floor, whether White and Pritchard can cover the creation Brown used to provide, and whether Queta and Robinson can coexist without muddying the offense. Watch who gains touches and defensive assignments early — those patterns will say more about Boston’s East standing than any single exhibition box score.",

  snapshotNotes: {
    playoffResult: 'First Round',
  },
};
