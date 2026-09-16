import { known, unknown, withDerivedResolution } from '@/lib/parlay-xray/fields';
import type { ExtractedParlayLeg, ParlayLegSide, XrayPropKind } from '@/lib/parlay-xray/types';
import type { XrayGameRecord, XrayPlayerRecord, XrayResolutionCatalog, XrayTeamRecord } from '../types';

export const PLAYERS: XrayPlayerRecord[] = [
  { playerId: '203999', entityId: 'ent-jokic', displayName: 'Nikola Jokic', firstName: 'Nikola', lastName: 'Jokic', nbaPlayerId: '203999' },
  { playerId: '203507', entityId: 'ent-giannis', displayName: 'Giannis Antetokounmpo', firstName: 'Giannis', lastName: 'Antetokounmpo', nbaPlayerId: '203507' },
  { playerId: '1629029', entityId: 'ent-luka', displayName: 'Luka Doncic', firstName: 'Luka', lastName: 'Doncic', nbaPlayerId: '1629029' },
  { playerId: '1631119', entityId: 'ent-jalen-w', displayName: 'Jalen Williams', firstName: 'Jalen', lastName: 'Williams', nbaPlayerId: '1631119' },
  { playerId: '1631116', entityId: 'ent-jaylin-w', displayName: 'Jaylin Williams', firstName: 'Jaylin', lastName: 'Williams', nbaPlayerId: '1631116' },
  { playerId: '1629057', entityId: 'ent-grant-w', displayName: 'Grant Williams', firstName: 'Grant', lastName: 'Williams', nbaPlayerId: '1629057' },
  { playerId: '1631094', entityId: 'ent-paolo', displayName: 'Paolo Banchero', firstName: 'Paolo', lastName: 'Banchero', nbaPlayerId: '1631094' },
  { playerId: '1628369', entityId: 'ent-tatum', displayName: 'Jayson Tatum', firstName: 'Jayson', lastName: 'Tatum', nbaPlayerId: '1628369' },
  { playerId: '1628389', entityId: 'ent-bam', displayName: 'Bam Adebayo', firstName: 'Bam', lastName: 'Adebayo', nbaPlayerId: '1628389' },
];

export const TEAMS: XrayTeamRecord[] = [
  { teamId: 'den', abbreviation: 'DEN', fullName: 'Denver Nuggets' },
  { teamId: 'okc', abbreviation: 'OKC', fullName: 'Oklahoma City Thunder' },
  { teamId: 'mil', abbreviation: 'MIL', fullName: 'Milwaukee Bucks' },
  { teamId: 'mia', abbreviation: 'MIA', fullName: 'Miami Heat' },
  { teamId: 'bos', abbreviation: 'BOS', fullName: 'Boston Celtics' },
  { teamId: 'lal', abbreviation: 'LAL', fullName: 'Los Angeles Lakers' },
  { teamId: 'min', abbreviation: 'MIN', fullName: 'Minnesota Timberwolves' },
  { teamId: 'nyk', abbreviation: 'NYK', fullName: 'New York Knicks' },
];

export const GAMES: XrayGameRecord[] = [
  {
    gameId: 'game-den-okc-2026-03-17',
    startTime: '2026-03-17T17:00:00.000Z',
    homeTeamAbbr: 'DEN',
    awayTeamAbbr: 'OKC',
  },
  {
    gameId: 'game-mil-mia-2026-03-17',
    startTime: '2026-03-17T17:00:00.000Z',
    homeTeamAbbr: 'MIL',
    awayTeamAbbr: 'MIA',
  },
  {
    gameId: 'game-den-okc-2025-04-01',
    startTime: '2025-04-01T17:00:00.000Z',
    homeTeamAbbr: 'DEN',
    awayTeamAbbr: 'OKC',
  },
];

export const CATALOG: XrayResolutionCatalog = {
  players: PLAYERS,
  teams: TEAMS,
  games: GAMES,
};

export function extractedLeg(partial: {
  id?: string;
  player?: string | null;
  team?: string | null;
  opponent?: string | null;
  matchup?: string | null;
  market?: XrayPropKind | null;
  marketLabel?: string | null;
  side?: ParlayLegSide | null;
  line?: number | null;
  odds?: number | null;
  sportsbook?: string | null;
  gameDate?: string | null;
}): ExtractedParlayLeg {
  return withDerivedResolution({
    id: partial.id ?? 'leg-1',
    playerDisplayName: partial.player ? known(partial.player) : unknown(),
    playerId: unknown(),
    nbaPlayerId: unknown(),
    teamAbbr: partial.team ? known(partial.team) : unknown(),
    opponentAbbr: partial.opponent ? known(partial.opponent) : unknown(),
    matchupLabel: partial.matchup ? known(partial.matchup) : unknown(),
    propKind: partial.market ? known(partial.market) : unknown(),
    propLabel: partial.marketLabel ? known(partial.marketLabel) : unknown(),
    side: partial.side ? known(partial.side) : unknown(),
    line: partial.line != null ? known(partial.line) : unknown(),
    oddsAmerican: partial.odds != null ? known(partial.odds) : unknown(),
    sportsbookText: partial.sportsbook ? known(partial.sportsbook) : unknown(),
    gameDate: partial.gameDate ? known(partial.gameDate) : unknown(),
    extractionConfidence: known('high'),
    resolution: 'unresolved',
    rawSnippet: null,
  });
}
