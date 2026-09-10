/**
 * Certified historical Starting Five contract (client-safe).
 * Do not import lineup archive / S3 / fs from this file.
 */

export const LINEUPS_2025_STARTER_ANOMALY_IDS = ['18447931', '18447988'] as const;

export type HistoricalStarterPlayer = {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string | null;
};

export type HistoricalStarters = {
  available: boolean;
  home: HistoricalStarterPlayer[];
  away: HistoricalStarterPlayer[];
};

export function isLineups2025StarterAnomaly(gameId: string): boolean {
  return (LINEUPS_2025_STARTER_ANOMALY_IDS as readonly string[]).includes(gameId);
}

export function emptyHistoricalStarters(): HistoricalStarters {
  return { available: false, home: [], away: [] };
}

export function normalizeCertifiedPosition(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function sid(v: unknown): string | null {
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Fail-closed product grouping. Partial fives are hidden, not shown as Starting Five.
 */
export function groupCertifiedStarters(
  rows: Array<{
    player_id: unknown;
    player_name?: unknown;
    team_id: unknown;
    position?: unknown;
  }>,
  homeTeamId: string,
  awayTeamId: string
): HistoricalStarters {
  const home: HistoricalStarterPlayer[] = [];
  const away: HistoricalStarterPlayer[] = [];
  for (const row of rows) {
    const playerId = sid(row.player_id);
    const teamId = sid(row.team_id);
    if (!playerId || !teamId) continue;
    const mapped: HistoricalStarterPlayer = {
      playerId,
      playerName: String(row.player_name ?? ''),
      teamId,
      position: normalizeCertifiedPosition(row.position),
    };
    if (teamId === homeTeamId) home.push(mapped);
    else if (teamId === awayTeamId) away.push(mapped);
  }
  if (home.length !== 5 || away.length !== 5) {
    return emptyHistoricalStarters();
  }
  return { available: true, home, away };
}

export function shouldShowStartingFive(starters: HistoricalStarters | null | undefined): boolean {
  return Boolean(
    starters?.available && starters.home.length === 5 && starters.away.length === 5
  );
}
