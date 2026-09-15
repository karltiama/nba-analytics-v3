import { FIRST_PROBE_GAMES } from './contract';
import type { CourtContextGame } from './types';

export function probeGamesFromUniverse(games: CourtContextGame[]): CourtContextGame[] {
  const wanted = new Set<string>(FIRST_PROBE_GAMES.map((g) => g.courtContextGameId));
  const found = games.filter((g) => wanted.has(g.courtContextGameId));
  if (found.length > 0) return found;
  return FIRST_PROBE_GAMES.map((g) => ({
    courtContextGameId: g.courtContextGameId,
    season: g.season,
    startTime: g.startTime,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    homeTeamName: g.homeTeamName,
    awayTeamName: g.awayTeamName,
    phase: g.season === '2023' && g.courtContextGameId === '15905067' ? 'playoff' : undefined,
  }));
}

export function probeCommands(execute = false): string[] {
  const flag = execute ? ' \\\n  --execute --yes' : '';
  return FIRST_PROBE_GAMES.map(
    (g) =>
      `npm run backfill:owls-props -- --game-id ${g.courtContextGameId} --run-id owls-probe-${g.season}-${g.courtContextGameId}${flag}`
  );
}
