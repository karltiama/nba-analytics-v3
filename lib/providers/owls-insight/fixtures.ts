import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OWLS_PATHS } from './contract';

export function loadOwlsFixtures(root = path.join(process.cwd(), 'fixtures/owls-insight')): Record<string, unknown> {
  const games = JSON.parse(readFileSync(path.join(root, 'history-games-page.json'), 'utf8'));
  const playerProps = JSON.parse(readFileSync(path.join(root, 'history-player-props-page.json'), 'utf8'));
  const snapshots = JSON.parse(readFileSync(path.join(root, 'history-props-page.json'), 'utf8'));
  const coverage = JSON.parse(readFileSync(path.join(root, 'history-coverage.json'), 'utf8'));
  const closingOdds = JSON.parse(readFileSync(path.join(root, 'history-closing-odds-page.json'), 'utf8'));
  const publicBetting = JSON.parse(readFileSync(path.join(root, 'history-public-betting-page.json'), 'utf8'));
  return {
    [OWLS_PATHS.historyGames]: games,
    [OWLS_PATHS.historyPlayerProps]: playerProps,
    [`${OWLS_PATHS.historyPlayerProps}?eventId=owls-fixture-event-1037995`]: playerProps,
    [OWLS_PATHS.historyProps]: snapshots,
    [OWLS_PATHS.historyCoverage]: coverage,
    [OWLS_PATHS.historyClosingOdds]: closingOdds,
    [OWLS_PATHS.historyPublicBetting]: publicBetting,
  };
}

export const FIXTURE_COURT_CONTEXT_GAMES = [
  {
    courtContextGameId: '1037995',
    season: '2023',
    startTime: '2023-12-25T22:00:00.000Z',
    homeTeam: 'LAL',
    awayTeam: 'BOS',
    homeTeamName: 'Los Angeles Lakers',
    awayTeamName: 'Boston Celtics',
    phase: 'regular' as const,
  },
];

export const FIXTURE_PLAYERS = [
  { playerId: '237', fullName: 'LeBron James', teamAbbr: 'LAL' },
  { playerId: '434', fullName: 'Jayson Tatum', teamAbbr: 'BOS' },
  { playerId: '999001', fullName: 'Jalen Johnson', teamAbbr: 'ATL' },
  { playerId: '999002', fullName: 'Jalen Johnson', teamAbbr: 'IND' },
];
