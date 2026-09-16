import { resolveNbaTeamAbbreviation } from '@/lib/nba/team-logos';
import type { ExtractedParlayLeg } from './types';

export type XrayMatchupSeparator = '@' | 'vs';

export type XrayMatchupDisplay = {
  left: string;
  right: string;
  separator: XrayMatchupSeparator;
};

const AT_SPLIT = /\s+@\s+/;
const VS_SPLIT = /\s+(?:vs\.?|v\.?)\s+/i;

function canonicalAbbr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return resolveNbaTeamAbbreviation(raw.trim());
}

function fromParts(
  leftRaw: string,
  rightRaw: string,
  separator: XrayMatchupSeparator
): XrayMatchupDisplay | null {
  const left = canonicalAbbr(leftRaw);
  const right = canonicalAbbr(rightRaw);
  if (!left || !right || left === right) return null;
  return { left, right, separator };
}

export function parseMatchupLabel(matchupLabel: string | null | undefined): XrayMatchupDisplay | null {
  const raw = matchupLabel?.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const atParts = raw.split(AT_SPLIT);
  if (atParts.length === 2 && atParts[0] && atParts[1]) {
    return fromParts(atParts[0], atParts[1], '@');
  }
  const vsParts = raw.split(VS_SPLIT);
  if (vsParts.length === 2 && vsParts[0] && vsParts[1]) {
    return fromParts(vsParts[0], vsParts[1], 'vs');
  }
  return null;
}

/**
 * Display matchup for extracted-leg rows.
 * Prefers the screenshot label order so home/away is not invented from player team vs opponent.
 */
export function matchupDisplayFromLeg(
  leg: Pick<ExtractedParlayLeg, 'teamAbbr' | 'opponentAbbr' | 'matchupLabel'>
): XrayMatchupDisplay | null {
  const fromLabel = parseMatchupLabel(leg.matchupLabel.value);
  if (fromLabel) return fromLabel;
  const team = canonicalAbbr(leg.teamAbbr.value);
  const opponent = canonicalAbbr(leg.opponentAbbr.value);
  if (!team || !opponent || team === opponent) return null;
  return { left: team, right: opponent, separator: 'vs' };
}
