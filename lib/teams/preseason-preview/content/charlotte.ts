import type { TeamPreseasonPreviewContent } from '../types';

/**
 * Charlotte Hornets — 2026–27 Team Preseason Preview (curated editorial).
 * Structured lists + prose only. Snapshot metrics come from live prior-season data when available.
 */
export const charlottePreseasonPreview: TeamPreseasonPreviewContent = {
  season: '2026',
  slug: 'CHA',
  teamId: '4',

  headline: 'Charlotte Hornets',
  dek: '[EDIT] One-line dek for Charlotte Hornets (2026–27). Prior RS: 44–38 regular-season (82 GP).',

  bigPicture: [
    'Charlotte enters 2026–27 in an interesting transition after a 44-win season showed that this young roster is capable of being competitive. The Hornets still have plenty of shooting and depth, but their offensive identity will look different as Kon Knueppel, Brandon Miller and Coby White take on greater responsibility within a more balanced attack. The biggest question is whether Charlotte can maintain its offensive efficiency without relying on one elite creator, while continued development from Knueppel, Miller and the rest of its young core will ultimately shape what this new version of the Hornets becomes.',
  ],

  keyQuestions: [
    {
      headline: 'Who absorbs the minutes previously associated with Miles Bridges and LaMelo Ball?',
      detail:
        'Charlotte has a significant amount of playing time and offensive responsibility to redistribute this season. The key question is not simply who replaces Bridges and Ball in the starting lineup, but which players earn those available minutes and how that reshapes the rotation. Brandon Miller, Kon Knueppel, Coby White and several offseason additions could all see their responsibilities expand, making Charlotte’s early-season rotation one of the most important things to monitor.'
    },
    
  ],

  additions: [
    {
      name: 'Dennis Schroder',
      nbaPlayerId: '203471',
      position: 'Guard',
      context: 'Ball handler / secondary creator',
    },
    {
      name: 'Dorian Finney-Smith',
      nbaPlayerId: '1627827',
      position: 'Forward',
      context: 'Strong defensive presence / floor spacing',
    },
    {
      name: 'Grayson Allen',
      nbaPlayerId: '1628960',
      position: 'Guard',
      context: 'Sharpshooting / floor spacing',
    },
    {
      name: 'Naz Reid',
      nbaPlayerId: '1629675',
      position: 'Center-Forward',
      context: 'Versatile big man / shooting',
    },
    {
      name: "Royce O'Neale",
      nbaPlayerId: '1626220',
      position: 'Forward',
      context: 'Dependable defender / 3 and D wing',
    },
  ],

  departures: [
    {
      name: 'Josh Green',
      nbaPlayerId: '1630182',
      position: 'Guard',
      context: '↔ UTA · [EDIT] add role/impact context',
    },
    {
      name: 'LaMelo Ball',
      nbaPlayerId: '1630163',
      position: 'Guard',
      context:
        '↔ MIN · review: TOP_MINUTES_CONFIRMED_DEPARTURE, HIGH_USAGE_CONFIRMED_DEPARTURE · [EDIT] add role/impact context',
    },
    {
      name: 'Miles Bridges',
      nbaPlayerId: '1628970',
      position: 'Forward',
      context:
        '↔ PHX · review: HIGH_MINUTES_CONFIRMED_DEPARTURE · [EDIT] add role/impact context',
    },
    {
      name: 'Tre Mann',
      nbaPlayerId: '1630544',
      position: 'Guard',
      context: '↔ WAS · [EDIT] add role/impact context',
    },
  ],

  draftPicks: [
    {
      name: 'Hannes Steinbach',
      nbaPlayerId: '1643419',
      position: 'Forward',
      context: '[EDIT] add role/impact context',
    },
    {
      name: 'Christian Anderson',
      nbaPlayerId: '1643515',
      position: 'Guard',
      context: '[EDIT] add role/impact context',
    },
  ],

  projectedRotation: {
    starters: {
      PG: { name: 'Coby White', nbaPlayerId: '1629632' },
      SG: { name: 'Brandon Miller', nbaPlayerId: '1641706' },
      SF: { name: 'Kon Knueppel', nbaPlayerId: '1642851' },
      PF: { name: 'Naz Reid', nbaPlayerId: '1629675' },
      C: { name: 'Hannes Stinbach', nbaPlayerId: '1631217' },
    },
    keyBench: [
      { name: 'Dennis Schroder', nbaPlayerId: '203471', position: 'G' },
      { name: 'Grayson Allen', nbaPlayerId: '1628960', position: 'G' },
      { name: 'Ryan Kalkbrenner', nbaPlayerId: '1641750', position: 'F' },
      { name: 'Sion James', nbaPlayerId: '1642883', position: 'G' },
      { name: 'Christian Anderson', nbaPlayerId: '1643515', position: 'G' },
    ],
  },

  playersToWatch: [
    {
      name: 'Coby White',
      nbaPlayerId: '1629632',
      jerseyNumber: '3',
      position: 'PG',
      meta: "PG · 6'4\" · Age 26",
      watching:
        'With LaMelo Ball departing, Coby White becomes the Hornets\' primary ball handler and primary creator. He will need to continue to improve his decision-making and playmaking to be successful in this role.',
    },
    {
      name: 'Brandon Miller',
      nbaPlayerId: '1641706',
      position: 'PF',
      meta: "SF · 6'7\" · Age 23",
      watching:
        'The Hornets will need Brandon Miller to continue to improve his game, with LaMelo and Bridges departing, he will need to step up and be a primary scorer and playmaker for the team.',
    },
    {
      name: 'Kon Knueppel',
      nbaPlayerId: '1642851',
      position: 'SG',
      meta: 'Prior ~31.1 MPG · 18.0 PPG',
      watching:
        'Kon Knueppel enters year two with a larger offensive burden, particularly as a ball handler and secondary creator. The key will be whether he can maintain his elite shooting while improving as a passer, rim attacker, and self-creator.',
    },
    
  ],

  roleWatch: [
    {
      player: { name: 'Naz Reid', nbaPlayerId: '1629675' },
      previousRole: 'Starting center',
      watch: 'Development ↑',
    },
    {
      player: { name: 'Coby White', nbaPlayerId: '1629632' },
      previousRole:
        'Coby White is a returning player with prior-season high usage under mean_usage_pct_played_games_v1 — a candidate for continued high-usage monitoring.',
      watch: 'Stable',
    },
    {
      player: { name: 'Brandon Miller', nbaPlayerId: '1641706' },
      previousRole:
        'Brandon Miller is a returning player with prior-season high usage under mean_usage_pct_played_games_v1 — a candidate for continued high-usage monitoring.',
      watch: 'Stable',
    },
    
  ],

  wowyContext: [
    {
      title: 'Who fills in the usage previously associated with LaMelo Ball and Miles Bridges?',
      detail:
        'Which players will need to step up and fill in the usage? This will be a key factor in the Hornets\' success this season.',
    },
    {
      title: 'How will Naz Reid perform in his new team?',
      detail:
        'Naz Reid enters year two with a larger offensive burden, particularly as a rim attacker and self-creator. The key will be whether he can maintain his elite shooting while improving as a passer, rim attacker, and self-creator.',
    }
  ],

  outlook:
    'The Hornets showed they can generate efficient offense while remaining competitive defensively, and much of their next step will come down to how their young core handles greater responsibility. Kon Knueppel, who led Charlotte’s returning players at 31.1 minutes per game, is central to that development as the team looks to build on last season’s progress without losing the offensive identity that made them successful.',

  snapshotNotes: {
    playoffResult: null,
  },
};
