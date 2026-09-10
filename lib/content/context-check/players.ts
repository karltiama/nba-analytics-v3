import type { ContextCheckStudioPlayer } from './types';

/**
 * Local player options for the v1 studio form.
 * No player-search API or identity-resolution path is used here.
 */
export const STUDIO_PLAYERS: readonly ContextCheckStudioPlayer[] = [
  {
    id: 'mock-jalen-brunson',
    name: 'Jalen Brunson',
    teamAbbreviation: 'NYK',
    teamName: 'New York Knicks',
  },
  {
    id: 'mock-shai-gilgeous-alexander',
    name: 'Shai Gilgeous-Alexander',
    teamAbbreviation: 'OKC',
    teamName: 'Oklahoma City Thunder',
  },
  {
    id: 'mock-nikola-jokic',
    name: 'Nikola Jokic',
    teamAbbreviation: 'DEN',
    teamName: 'Denver Nuggets',
  },
  {
    id: 'mock-tyrese-haliburton',
    name: 'Tyrese Haliburton',
    teamAbbreviation: 'IND',
    teamName: 'Indiana Pacers',
  },
  {
    id: 'mock-jayson-tatum',
    name: 'Jayson Tatum',
    teamAbbreviation: 'BOS',
    teamName: 'Boston Celtics',
  },
  {
    id: 'mock-anthony-edwards',
    name: 'Anthony Edwards',
    teamAbbreviation: 'MIN',
    teamName: 'Minnesota Timberwolves',
  },
  {
    id: 'mock-luka-doncic',
    name: 'Luka Doncic',
    teamAbbreviation: 'LAL',
    teamName: 'Los Angeles Lakers',
  },
  {
    id: 'mock-trae-young',
    name: 'Trae Young',
    teamAbbreviation: 'ATL',
    teamName: 'Atlanta Hawks',
  },
];

export function findStudioPlayer(playerId: string): ContextCheckStudioPlayer | undefined {
  return STUDIO_PLAYERS.find((player) => player.id === playerId);
}

export function searchStudioPlayers(query: string): ContextCheckStudioPlayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...STUDIO_PLAYERS];
  return STUDIO_PLAYERS.filter((player) => {
    return (
      player.name.toLowerCase().includes(q) ||
      player.teamAbbreviation.toLowerCase().includes(q) ||
      player.teamName.toLowerCase().includes(q)
    );
  });
}
