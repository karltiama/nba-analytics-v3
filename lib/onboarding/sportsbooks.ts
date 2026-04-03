/** Common U.S. sportsbooks for onboarding search; users can still type a custom name. */
export const SPORTSBOOK_OPTIONS: readonly string[] = [
  'bet365',
  'BetMGM',
  'BetRivers',
  'Caesars',
  'DraftKings',
  'ESPN BET',
  'Fanatics Sportsbook',
  'FanDuel',
  'Fliff',
  'Hard Rock Bet',
  'PrizePicks',
  'Underdog Fantasy',
].sort((a, b) => a.localeCompare(b));
