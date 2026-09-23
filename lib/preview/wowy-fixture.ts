import { classifyWowyGames } from '@/lib/wowy/eligibility';
import { summarizeWowyPair } from '@/lib/wowy/aggregate';
import type { WowyLoadedGame, WowyPairQuery, WowyPairSummary, WowyPlayerIdentity, WowyTeamStintOption, WowyTeammateOption } from '@/lib/wowy/types';
import {
  playerDisplayName,
  PREVIEW_PLAYERS,
  PREVIEW_TEAMS,
  previewPlayerById,
  type PreviewPlayer,
} from './catalog';
import { previewId } from './ids';
import type { PreviewScenario } from './scenario';

const SEASON_POINT_OFFSET: Record<string, number> = {
  '2023': 0,
  '2024': 2.4,
  '2025': -1.2,
};

function identity(player: PreviewPlayer, scenario: PreviewScenario): WowyPlayerIdentity {
  return {
    playerId: player.wowyId,
    fullName: playerDisplayName(player, scenario),
    position: player.position,
    playerEntityId: previewId(`entity-${player.key}`),
    nbaPlayerId: null,
    identityOk: true,
    identityReason: null,
  };
}

function loadedGame(
  query: WowyPairQuery,
  index: number,
  side: 'with' | 'without',
  points: number
): WowyLoadedGame {
  const without = side === 'without';
  const day = String((index % 27) + 1).padStart(2, '0');
  const month = side === 'with' ? '01' : '02';
  return {
    gameId: previewId(`wowy-${side}-${query.subjectPlayerId}-${index + 1}`),
    startTime: `${query.season}-${month}-${day}T00:00:00.000Z`,
    gameDate: `${query.season}-${month}-${day}`,
    season: query.season,
    status: 'Final',
    homeScore: 112,
    awayScore: 106,
    subjectTeamId: query.teamId,
    homeTeamId: query.teamId,
    opponentTeamId: previewId('team-cinder'),
    opponentAbbr: 'CBN',
    subjectMinutes: '34',
    subjectPts: points,
    subjectReb: without ? 4 : 7,
    subjectAst: without ? 3 : 6,
    subjectTpm: without ? 1 : 3,
    subjectFga: 16,
    subjectTpa: 6,
    subjectFta: 4,
    teammateRowPresent: true,
    teammateTeamId: query.teamId,
    teammateMinutes: without ? '00' : '31',
    teammatePts: without ? 0 : 18,
    teammateReb: without ? 0 : 8,
    teammateAst: without ? 0 : 4,
    teammateTpm: without ? 0 : 1,
    teammateFga: without ? 0 : 14,
    teammateFta: without ? 0 : 3,
    teamPts: null,
    teamReb: null,
    teamAst: null,
    teamTpm: null,
    teamFga: null,
    teamTpa: null,
    teamFta: null,
    teamOppPts: null,
  };
}

export function previewWowySummary(input: {
  scenario: PreviewScenario;
  subjectPlayerId: string;
  teammatePlayerId: string | null;
  season: string;
  teamId: string;
  seasonType: 'regular' | 'playoffs' | 'all';
}): { status: number; body: unknown } {
  if (input.scenario === 'error') {
    return { status: 500, body: { error: 'Failed to load WOWY pair.' } };
  }
  const subject = previewPlayerById(input.subjectPlayerId) ?? PREVIEW_PLAYERS[0];
  const teammate = input.teammatePlayerId ? previewPlayerById(input.teammatePlayerId) : null;
  const query: WowyPairQuery = {
    subjectPlayerId: input.subjectPlayerId,
    teammatePlayerId: input.teammatePlayerId,
    season: input.season || '2025',
    teamId: input.teamId || PREVIEW_TEAMS.herons.id,
    seasonType: input.seasonType,
  };
  if (input.scenario === 'empty') {
    const summary = summarizeWowyPair({
      query,
      classified: [],
      subjectName: playerDisplayName(subject, input.scenario),
      teammateName: teammate ? playerDisplayName(teammate, input.scenario) : null,
      teamAbbreviation: 'HCH',
      teamFullName: PREVIEW_TEAMS.herons.name,
    });
    return { status: 200, body: { summary } };
  }
  const offset = SEASON_POINT_OFFSET[query.season] ?? 0;
  const teammateBump = teammate?.key === 'okonkwo' ? 4 : teammate?.key === 'bellamy' ? -3 : 1.5;
  const gamesPerSide = input.scenario === 'partial' ? 2 : 6;
  const games: WowyLoadedGame[] = [];
  for (let i = 0; i < gamesPerSide; i += 1) {
    games.push(loadedGame(query, i, 'with', 22 + offset + teammateBump));
    games.push(loadedGame(query, i, 'without', 28 + offset - teammateBump));
  }
  const summary: WowyPairSummary = summarizeWowyPair({
    query,
    classified: classifyWowyGames(games, query),
    subjectName: playerDisplayName(subject, input.scenario),
    teammateName: teammate ? playerDisplayName(teammate, input.scenario) : null,
    teamAbbreviation: 'HCH',
    teamFullName:
      input.scenario === 'mobile-dense' ? PREVIEW_TEAMS.herons.denseName : PREVIEW_TEAMS.herons.name,
  });
  return { status: 200, body: { summary } };
}

export function previewWowyPlayers(scenario: PreviewScenario, query: string): { status: number; body: unknown } {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Failed to search players.' } };
  }
  if (scenario === 'empty' || query.trim().length < 2) {
    return { status: 200, body: { players: [] } };
  }
  const needle = query.trim().toLowerCase();
  const players = PREVIEW_PLAYERS.filter((player) => {
    const name = playerDisplayName(player, scenario).toLowerCase();
    return name.includes(needle) || player.name.toLowerCase().includes(needle);
  }).map((player) => identity(player, scenario));
  return { status: 200, body: { players } };
}

export function previewWowyContext(scenario: PreviewScenario, playerId: string, season: string, teamId: string): {
  status: number;
  body: unknown;
} {
  if (scenario === 'error') {
    return { status: 500, body: { error: 'Failed to load WOWY context.' } };
  }
  const player = previewPlayerById(playerId);
  if (!player || scenario === 'empty') {
    return { status: 404, body: { error: 'Player not found.' } };
  }
  const team = PREVIEW_TEAMS[player.teamKey];
  const teams: WowyTeamStintOption[] = [
    {
      teamId: team.id,
      abbreviation: team.abbreviation,
      fullName: scenario === 'mobile-dense' ? team.denseName : team.name,
      firstGameDate: '2023-10-24',
      lastGameDate: '2026-04-02',
      gameCount: scenario === 'partial' ? 4 : 62,
      verifiedTradeDates: false,
      evidence: 'game_log_team_id',
    },
    {
      teamId: PREVIEW_TEAMS.owls.id,
      abbreviation: PREVIEW_TEAMS.owls.abbreviation,
      fullName: PREVIEW_TEAMS.owls.name,
      firstGameDate: '2024-10-22',
      lastGameDate: '2025-04-10',
      gameCount: 18,
      verifiedTradeDates: false,
      evidence: 'game_log_team_id',
    },
  ];
  const seasons = ['2023', '2024', '2025'];
  const activeTeam = teamId || team.id;
  const teammates: WowyTeammateOption[] =
    scenario === 'partial'
      ? [teammateOption(PREVIEW_PLAYERS[1], scenario, 4, 2)]
      : PREVIEW_PLAYERS.filter((row) => row.wowyId !== player.wowyId).map((row, index) =>
          teammateOption(row, scenario, 20 - index, 8 - index)
        );
  return {
    status: 200,
    body: {
      player: identity(player, scenario),
      teams: scenario === 'partial' ? teams.slice(0, 1) : teams,
      teammates: activeTeam ? teammates : [],
      seasons,
      season,
      stintNote: 'Preview stints are fixture coverage, not verified transactions.',
    },
  };
}

function teammateOption(
  player: PreviewPlayer,
  scenario: PreviewScenario,
  together: number,
  dnp: number
): WowyTeammateOption {
  return {
    playerId: player.wowyId,
    fullName: playerDisplayName(player, scenario),
    position: player.position,
    nbaPlayerId: null,
    sharedRosterGames: together + dnp,
    togetherPlayedGames: together,
    verifiedDnpGames: dnp,
  };
}
