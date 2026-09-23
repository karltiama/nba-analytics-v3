import { previewId, previewNumericId } from './ids';
import type { PreviewScenario } from './scenario';

export const PREVIEW_DATE_ET = '2026-04-02';
export const PREVIEW_SNAPSHOT_AT = '2026-04-02T20:00:00.000Z';
export const PREVIEW_SEASON = '2025';

export type PreviewTeam = {
  id: string;
  abbreviation: string;
  name: string;
  denseName: string;
  record: string;
};

export type PreviewPlayer = {
  key: string;
  playerId: number;
  wowyId: string;
  name: string;
  denseName: string;
  position: string;
  teamKey: 'herons' | 'rapids' | 'owls';
  sparse: boolean;
};

export type PreviewPropSeed = {
  id: string;
  playerKey: PreviewPlayer['key'];
  gameKey: 'herons-rapids' | 'owls-cinder';
  propType: 'points' | 'rebounds' | 'assists' | 'threes';
  side: 'over' | 'under';
  lineValue: number;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  ev: number | null;
  projection: number | null;
  confidenceTier: 'high' | 'medium' | 'low' | null;
  sportsbook: string;
  includeInDefault: boolean;
  includeInPartial: boolean;
};

export const PREVIEW_TEAMS: Record<PreviewTeam['id'] extends never ? never : string, PreviewTeam> = {
  herons: {
    id: previewId('team-herons'),
    abbreviation: 'HCH',
    name: 'Harbor City Herons',
    denseName: 'Harbor City Maritime Herons',
    record: '41-28',
  },
  rapids: {
    id: previewId('team-rapids'),
    abbreviation: 'RWR',
    name: 'Redwood Rapids',
    denseName: 'Redwood Valley Rapids',
    record: '46-23',
  },
  owls: {
    id: previewId('team-owls'),
    abbreviation: 'LVN',
    name: 'Lumen Valley Night Owls',
    denseName: 'Lumen Valley Night Owls Basketball Club',
    record: '33-36',
  },
  cinder: {
    id: previewId('team-cinder'),
    abbreviation: 'CBN',
    name: 'Cinder Basin',
    denseName: 'Cinder Basin Foundrymen',
    record: '29-40',
  },
};

export const PREVIEW_PLAYERS: readonly PreviewPlayer[] = [
  {
    key: 'ellison',
    playerId: previewNumericId(1),
    wowyId: previewId('wowy-ellison'),
    name: 'Mara Ellison',
    denseName: 'Mara Ellison',
    position: 'G',
    teamKey: 'herons',
    sparse: false,
  },
  {
    key: 'okonkwo',
    playerId: previewNumericId(2),
    wowyId: previewId('wowy-okonkwo'),
    name: 'Jules Okonkwo',
    denseName: 'Jules Okonkwo',
    position: 'F',
    teamKey: 'herons',
    sparse: false,
  },
  {
    key: 'varga',
    playerId: previewNumericId(3),
    wowyId: previewId('wowy-varga'),
    name: 'Nico Varga',
    denseName: 'Nico Varga',
    position: 'C',
    teamKey: 'rapids',
    sparse: false,
  },
  {
    key: 'pell',
    playerId: previewNumericId(4),
    wowyId: previewId('wowy-pell'),
    name: 'Andre Pell',
    denseName: 'Andre Pell',
    position: 'G',
    teamKey: 'rapids',
    sparse: true,
  },
  {
    key: 'bellamy',
    playerId: previewNumericId(5),
    wowyId: previewId('wowy-bellamy'),
    name: 'Chris Bellamy',
    denseName: 'Christopher-James Okonkwo-Bellamy',
    position: 'F',
    teamKey: 'owls',
    sparse: false,
  },
];

export const PREVIEW_GAMES = [
  {
    key: 'herons-rapids' as const,
    gameId: previewNumericId(101),
    awayKey: 'herons' as const,
    homeKey: 'rapids' as const,
    startTime: '7:30 PM ET',
    status: 'Scheduled',
  },
  {
    key: 'owls-cinder' as const,
    gameId: previewNumericId(102),
    awayKey: 'owls' as const,
    homeKey: 'cinder' as const,
    startTime: '10:00 PM ET',
    status: 'Scheduled',
  },
];

export const PREVIEW_PROPS: readonly PreviewPropSeed[] = [
  {
    id: previewId('prop-ellison-pts'),
    playerKey: 'ellison',
    gameKey: 'herons-rapids',
    propType: 'points',
    side: 'over',
    lineValue: 27.5,
    oddsAmerican: -110,
    impliedProbability: 0.524,
    ev: 0.062,
    projection: 29.1,
    confidenceTier: 'high',
    sportsbook: 'DraftKings',
    includeInDefault: true,
    includeInPartial: true,
  },
  {
    id: previewId('prop-ellison-ast'),
    playerKey: 'ellison',
    gameKey: 'herons-rapids',
    propType: 'assists',
    side: 'over',
    lineValue: 6.5,
    oddsAmerican: -125,
    impliedProbability: 0.556,
    ev: -0.041,
    projection: 5.8,
    confidenceTier: 'medium',
    sportsbook: 'FanDuel',
    includeInDefault: true,
    includeInPartial: true,
  },
  {
    id: previewId('prop-okonkwo-reb'),
    playerKey: 'okonkwo',
    gameKey: 'herons-rapids',
    propType: 'rebounds',
    side: 'under',
    lineValue: 8.5,
    oddsAmerican: 102,
    impliedProbability: 0.495,
    ev: 0.018,
    projection: 7.9,
    confidenceTier: 'low',
    sportsbook: 'BetMGM',
    includeInDefault: true,
    includeInPartial: false,
  },
  {
    id: previewId('prop-varga-3pm'),
    playerKey: 'varga',
    gameKey: 'herons-rapids',
    propType: 'threes',
    side: 'over',
    lineValue: 1.5,
    oddsAmerican: 180,
    impliedProbability: 0.357,
    ev: 0.11,
    projection: 2.1,
    confidenceTier: 'medium',
    sportsbook: 'Caesars',
    includeInDefault: true,
    includeInPartial: false,
  },
  {
    id: previewId('prop-pell-pts'),
    playerKey: 'pell',
    gameKey: 'herons-rapids',
    propType: 'points',
    side: 'over',
    lineValue: 12.5,
    oddsAmerican: null,
    impliedProbability: null,
    ev: null,
    projection: null,
    confidenceTier: null,
    sportsbook: 'DraftKings',
    includeInDefault: true,
    includeInPartial: true,
  },
  {
    id: previewId('prop-bellamy-pts'),
    playerKey: 'bellamy',
    gameKey: 'owls-cinder',
    propType: 'points',
    side: 'over',
    lineValue: 36.5,
    oddsAmerican: -450,
    impliedProbability: 0.818,
    ev: -0.08,
    projection: 34.2,
    confidenceTier: 'high',
    sportsbook: 'DraftKings',
    includeInDefault: true,
    includeInPartial: false,
  },
  {
    id: previewId('prop-bellamy-reb'),
    playerKey: 'bellamy',
    gameKey: 'owls-cinder',
    propType: 'rebounds',
    side: 'over',
    lineValue: 11.5,
    oddsAmerican: 1800,
    impliedProbability: 0.053,
    ev: 0.22,
    projection: 12.4,
    confidenceTier: 'low',
    sportsbook: 'FanDuel',
    includeInDefault: false,
    includeInPartial: false,
  },
  {
    id: previewId('prop-bellamy-ast'),
    playerKey: 'bellamy',
    gameKey: 'owls-cinder',
    propType: 'assists',
    side: 'under',
    lineValue: 4.5,
    oddsAmerican: -105,
    impliedProbability: 0.512,
    ev: -0.015,
    projection: 4.8,
    confidenceTier: 'medium',
    sportsbook: 'BetMGM',
    includeInDefault: false,
    includeInPartial: false,
  },
  {
    id: previewId('prop-bellamy-3pm'),
    playerKey: 'bellamy',
    gameKey: 'owls-cinder',
    propType: 'threes',
    side: 'over',
    lineValue: 3.5,
    oddsAmerican: 114,
    impliedProbability: 0.467,
    ev: 0.09,
    projection: 4.0,
    confidenceTier: 'high',
    sportsbook: 'Caesars',
    includeInDefault: false,
    includeInPartial: false,
  },
  {
    id: previewId('prop-okonkwo-pts'),
    playerKey: 'okonkwo',
    gameKey: 'owls-cinder',
    propType: 'points',
    side: 'over',
    lineValue: 18.5,
    oddsAmerican: -115,
    impliedProbability: 0.535,
    ev: 0.033,
    projection: 19.6,
    confidenceTier: 'medium',
    sportsbook: 'DraftKings',
    includeInDefault: false,
    includeInPartial: false,
  },
];

export function previewPlayerByKey(key: string): PreviewPlayer {
  const player = PREVIEW_PLAYERS.find((row) => row.key === key);
  if (!player) throw new Error(`Missing preview player ${key}`);
  return player;
}

export function previewPlayerById(playerId: string | number): PreviewPlayer | null {
  const numeric = Number(playerId);
  return (
    PREVIEW_PLAYERS.find(
      (row) => row.playerId === numeric || row.wowyId === String(playerId)
    ) ?? null
  );
}

export function teamDisplayName(team: PreviewTeam, scenario: PreviewScenario): string {
  return scenario === 'mobile-dense' ? team.denseName : team.name;
}

export function playerDisplayName(player: PreviewPlayer, scenario: PreviewScenario): string {
  return scenario === 'mobile-dense' ? player.denseName : player.name;
}

export function propsForScenario(scenario: PreviewScenario): readonly PreviewPropSeed[] {
  if (scenario === 'empty' || scenario === 'error') return [];
  if (scenario === 'partial') return PREVIEW_PROPS.filter((row) => row.includeInPartial);
  if (scenario === 'mobile-dense') return PREVIEW_PROPS;
  return PREVIEW_PROPS.filter((row) => row.includeInDefault);
}
