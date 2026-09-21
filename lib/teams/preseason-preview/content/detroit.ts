import type { TeamPreseasonPreviewContent } from '../types';

/**
 * Detroit Pistons — 2026–27 Team Preseason Preview (curated editorial).
 * Structured lists + prose only. Snapshot metrics come from live prior-season data when available.
 */
export const detroitPreseasonPreview: TeamPreseasonPreviewContent = {
  season: '2026',
  slug: 'DET',
  teamId: '9',

  headline: 'Detroit Pistons',
  dek: 'DEEEEETRRRROITTTT BASKETBALLLLL.',

  bigPicture: [
    'Detroit enters the 2026–27 season coming off a 60-win campaign that ended with another disappointing playoff exit, leaving questions about whether this roster is built to take the next step. The Pistons added shooting and athleticism with John Collins, Isaiah Joe, Taurean Prince and Gary Harris, but lost important contributors in Tobias Harris and Isaiah Stewart and still lack a proven secondary creator alongside Cade Cunningham. With Jalen Duren’s future unresolved and much of Detroit’s upside dependent on internal growth from Duren and Ausar Thompson, the biggest challenge will be finding more reliable offense when playoff defenses load up on Cunningham. Detroit should remain one of the East’s stronger defensive teams, but its postseason ceiling may depend on whether Collins, Duren, Thompson or another player can emerge as a consistent second scoring option.',
  ],

  keyQuestions: [
    {
      headline: "How will Duren's contract dispute be resolved? Will it affect the team in the long run?",
      detail:
        "Jalen Duren and the Detroit Pistons are in a contract stalemate ahead of an October 1 deadline, with Duren reportedly seeking a deal worth over $200 million while the team's offer sits closer to $190 million. The dispute has grown emotional following Ausar Thompson's recent extension, forcing Detroit to weigh a long-term deal against Duren potentially playing on a $9.6 million qualifying offer.",
    },
    {
      headline: 'Who will step up as the consistent secondary scorer come playoff time?',
      detail:
        "Last season, Detroit’s second-leading scorer during the regular season, Jalen Duren, struggled mightily to produce offensively in the playoffs. With Tobias Harris, the Pistons’ second-leading postseason scorer, now in San Antonio, Detroit will need someone to consistently relieve the scoring pressure on Cade Cunningham. Will Duren overcome his postseason offensive struggles? Can Ausar Thompson make the offensive leap? Or can John Collins fill the scoring void left by Harris?",
    },
  ],

  additions: [
    {
      name: 'John Collins.',
      nbaPlayerId: '1628381',
      position: 'Wing',
      context: 'Bench scoring / spacing',
    },
    {
      name: 'Isaiah Joe',
      nbaPlayerId: '1630198',
      position: 'Forward',
      context: 'Veteran scoring / frontcourt depth',
    },
    {
      name: 'Gary Harris',
      nbaPlayerId: '203914',
      position: 'Guard',
      context: 'Secondary creation / shot creation',
    },
    {
      name: 'Taurean Prince',
      nbaPlayerId: '1627752',
      position: 'Wing',
      context: 'Floor spacing / shooting',
    },
  ],

  departures: [
    {
      name: 'Tobias Harris',
      nbaPlayerId: '202699',
      position: 'Guard',
      context: 'Floor spacing / shooting vacated',
    },
    {
      name: 'Caris LeVert',
      nbaPlayerId: '1627747',
      position: 'Wing',
      context: 'Bench scoring / spacing',
    },
    {
      name: 'Marcus Sasser',
      nbaPlayerId: '1631204',
      position: 'Wing',
      context: 'Bench scoring / spacing',
    },
    {
      name: 'Isaiah Stewart',
      nbaPlayerId: '1630191',
      position: 'Wing',
      context: 'Bench scoring / spacing',
    },
  ],

  draftPicks: [
    {
      name: 'Ebuka Okorie',
      nbaPlayerId: '1643536',
      position: 'Guard',
      context: 'No. 17 — downhill creation / secondary ball-handling',
    },
    {
      name: 'Ugonna Onyenso',
      nbaPlayerId: '1642391',
      position: 'Center',
      context: 'No. 53 — rim protection / two-way depth',
    },
  ],

  projectedRotation: {
    starters: {
      PG: { name: 'Cade Cunningham', nbaPlayerId: '1630595' },
      SG: { name: 'Duncan Robinson', nbaPlayerId: '1631093' },
      SF: { name: 'Ausar Thompson', nbaPlayerId: '1641709' },
      PF: { name: 'John Collins', nbaPlayerId: '202699' },
      C: { name: 'Jalen Duren', nbaPlayerId: '1631105' },
    },
    keyBench: [
      { name: 'Dannis Jenkins', nbaPlayerId: '1641757', position: 'G' },  // Correct: Dannis Jenkins (1641757)
      { name: 'Isaiah Joe', nbaPlayerId: '1630198', position: 'F' },      // Correct: Isaiah Joe (1630198)
      { name: 'Ron Holland', nbaPlayerId: '1641729', position: 'F/C' },   // Correct: Ron Holland (1641729)
      { name: 'Paul Reed', nbaPlayerId: '1630194', position: 'F' },       // Correct: Paul Reed (1630194)
    ],
  },

  playersToWatch: [
    {
      name: 'Daniss Jenkins',
      nbaPlayerId: '1642450',
      jerseyNumber: '24',
      position: 'PG',
      meta: "PG · 6'4\" · Age 25",
      watching:
        'Daniss Jenkins emerged as a reliable rotation piece last season, providing scoring and secondary playmaking off the bench. Entering 2026–27, he should remain an important part of Detroit’s second unit with a chance to earn a larger role through consistent production and decision-making.',
    },
    {
      name: 'Isaiah Joe',
      nbaPlayerId: '1630198',
      jerseyNumber: '11',
      position: 'SG',
      meta: "SG · 6'4\" · Age 27",
      watching:
        'Isaiah Joe gives Detroit a proven high-volume three-point threat who should immediately improve the spacing around Cade Cunningham. His catch-and-shoot ability and defensive effort also make him a strong fit for a Pistons team that wants to create offense from its defense.',
    },
    {
      name: 'Ausar Thompson',
      nbaPlayerId: '1641709',
      jerseyNumber: '9',
      position: 'SF',
      meta: "SF · 6'7\" · Age 23",
      watching:
        'Two-way wing with a minutes upside case. Track defensive assignments, transition involvement, and whether starting runway sticks once the rotation compresses.',
    },
  ],

  roleWatch: [
    {
      player: { name: 'Cade Cunningham', nbaPlayerId: '1630595' },
      previousRole: 'Primary creator',
      watch: 'Stable',
    },
    {
      player: { name: 'Jaden Ivey', nbaPlayerId: '1631093' },
      previousRole: 'Secondary option',
      watch: 'Opportunity ↑',
    },
    {
      player: { name: 'Ausar Thompson', nbaPlayerId: '1641709' },
      previousRole: 'Two-way wing',
      watch: 'Minutes ↑',
    },
    {
      player: { name: 'Jalen Duren', nbaPlayerId: '1631105' },
      previousRole: 'Starting center',
      watch: 'Development ↑',
    },
    {
      player: { name: 'Tobias Harris', nbaPlayerId: '202699' },
      previousRole: 'New to Detroit',
      watch: 'Role TBD',
    },
  ],

  wowyContext: [
    {
      title: 'When Cade sits',
      detail:
        'Which teammates historically absorb minutes, usage, assists, or shot volume in games he misses? Treat prior with/without splits as descriptive history — not a guarantee in a new lineup.',
    },
    {
      title: 'Spacing companions',
      detail:
        'Monitor which shooters share the floor with the primary creator most often in preseason. Court Context will later compare those combinations against historical participation splits where sample allows.',
    },
  ],

  outlook:
    "Detroit's preseason may be less about one dramatic change and more about how opportunities redistribute throughout the rotation. The biggest signal to watch is which players gain minutes, touches, and creation responsibility alongside Cade Cunningham — and whether those patterns hold once the regular season compresses the bench.",

  snapshotNotes: {
    playoffResult: null,
  },
};
