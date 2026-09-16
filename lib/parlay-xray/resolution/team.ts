import { normalizeTeamKey, TEAM_ALIASES } from '@/lib/providers/owls-insight/mapping';
import type { XrayTeamRecord } from './types';

const KNOWN_ABBR = new Set(Object.values(TEAM_ALIASES));

export function resolveTeamAbbr(
  raw: string | null | undefined,
  teams: XrayTeamRecord[]
): { abbreviation: string; teamId: string | null } | null {
  const abbr = normalizeTeamKey(raw);
  if (!abbr) return null;
  const hit = teams.find((t) => t.abbreviation.toUpperCase() === abbr);
  if (hit) return { abbreviation: hit.abbreviation, teamId: hit.teamId };
  if (KNOWN_ABBR.has(abbr)) return { abbreviation: abbr, teamId: null };
  return null;
}

const MATCHUP_SPLIT = /\s+(?:vs\.?|v\.?|@)\s+/i;

export function parseMatchupAbbrs(
  matchup: string | null | undefined,
  teams: XrayTeamRecord[]
): { left: string; right: string } | null {
  if (!matchup) return null;
  const parts = matchup.split(MATCHUP_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const left = resolveTeamAbbr(parts[0], teams);
  const right = resolveTeamAbbr(parts[1], teams);
  if (!left || !right || left.abbreviation === right.abbreviation) return null;
  return { left: left.abbreviation, right: right.abbreviation };
}
