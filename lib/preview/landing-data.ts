import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import type { Game } from '@/components/betting';
import type { LandingParlayXrayDemo } from '@/lib/landing/parlay-xray-demo';
import type { LandingWowyDemoScenario } from '@/lib/landing/wowy-demo';
import { PREVIEW_GAMES, PREVIEW_PLAYERS, PREVIEW_TEAMS, playerDisplayName, teamDisplayName } from './catalog';
import { previewExplorerRows } from './props-fixture';
import type { PreviewScenario } from './scenario';
import { loadCourtContextXrayPreview } from './xray-preview';
import { previewWowySummary } from './wowy-fixture';
import { liveCombinedOdds } from '@/lib/parlay-xray/session';
import { detectStructuralDependencies } from '@/lib/parlay-xray/structural';
import { EXTRACTION_STAGE_COPY } from '@/lib/parlay-xray/copy';
import type { WowyPairSummary } from '@/lib/wowy/types';

export type LandingPreviewPlayer = {
  name: string;
  team: string;
  position: string;
  nbaId: number;
  l5: number;
  vsSzn: number;
  badge?: { label: string; color: string };
};

export type LandingPreviewPropRow = {
  player: string;
  prop: string;
  side: string;
  line: string;
  book: string;
  odds: string;
  implied: string;
  conf: string;
  model: string;
  ev: string;
  proj: string;
  updated: string;
};

function asGame(
  game: (typeof PREVIEW_GAMES)[number],
  scenario: PreviewScenario
): Game {
  const home = PREVIEW_TEAMS[game.homeKey];
  const away = PREVIEW_TEAMS[game.awayKey];
  const homeMl = scenario === 'partial' ? null : -145;
  const awayMl = scenario === 'partial' ? null : 125;
  const market = twoWayMarketDisplay(awayMl, homeMl);
  return {
    id: String(game.gameId),
    gameDate: '2026-04-02',
    homeTeam: {
      id: home.id,
      name: teamDisplayName(home, scenario),
      abbreviation: home.abbreviation,
      record: scenario === 'empty' ? null : home.record,
    },
    awayTeam: {
      id: away.id,
      name: teamDisplayName(away, scenario),
      abbreviation: away.abbreviation,
      record: scenario === 'empty' ? null : away.record,
    },
    startTime: game.startTime,
    homeOdds: { moneyline: homeMl, spread: scenario === 'partial' ? null : -3.5, spreadOdds: -110 },
    awayOdds: { moneyline: awayMl, spread: scenario === 'partial' ? null : 3.5, spreadOdds: -110 },
    overUnder: scenario === 'partial' ? null : 224.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: market?.homePct ?? null,
    awayImpliedProb: market?.awayPct ?? null,
    isFavorite: market?.favorite ?? null,
    isClose: market?.isClose ?? false,
    matchupContext:
      scenario === 'mobile-dense'
        ? 'Harbor City Maritime Herons enter on the second night of a back-to-back after a cross-country trip.'
        : 'Preview slate. Rest and travel context is fixture copy.',
  };
}

function oddsText(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

export function landingPreviewGames(scenario: PreviewScenario): Game[] {
  if (scenario === 'empty' || scenario === 'error') return [];
  const games = scenario === 'partial' ? PREVIEW_GAMES.slice(0, 1) : PREVIEW_GAMES;
  return games.map((game) => asGame(game, scenario));
}

export function landingPreviewPlayers(scenario: PreviewScenario): LandingPreviewPlayer[] {
  if (scenario === 'empty' || scenario === 'error') return [];
  const players = scenario === 'partial' ? PREVIEW_PLAYERS.slice(0, 2) : PREVIEW_PLAYERS;
  return players.map((player, index) => ({
    name: playerDisplayName(player, scenario),
    team: PREVIEW_TEAMS[player.teamKey].abbreviation,
    position: player.position,
    nbaId: player.playerId,
    l5: 18 + index * 3.2,
    vsSzn: 4.5 + index,
    badge:
      index === 0
        ? { label: 'HOT', color: '#ff6b35' }
        : index === 3
          ? { label: 'PRA↑', color: '#bf5af2' }
          : undefined,
  }));
}

export function landingPreviewPropRows(scenario: PreviewScenario): LandingPreviewPropRow[] {
  return previewExplorerRows(scenario).map((row) => ({
    player: row.playerName,
    prop: row.propType,
    side: row.side === 'over' ? 'Over' : 'Under',
    line: String(row.lineValue),
    book: row.sportsbook,
    odds: oddsText(row.oddsAmerican),
    implied: row.impliedProbability == null ? '—' : `${(row.impliedProbability * 100).toFixed(1)}%`,
    conf: row.confidenceTier ?? '—',
    model: row.ev == null ? '—' : `${((0.5 + row.ev) * 100).toFixed(1)}%`,
    ev: row.ev == null ? '—' : `${row.ev > 0 ? '+' : ''}${(row.ev * 100).toFixed(1)}%`,
    proj: row.projection == null ? '—' : row.projection.toFixed(1),
    updated: '4/2/2026, 4:00:00 PM',
  }));
}

export function landingPreviewXray(scenario: PreviewScenario): LandingParlayXrayDemo | null {
  const loaded =
    scenario === 'error' ? loadCourtContextXrayPreview('empty') : loadCourtContextXrayPreview(scenario);
  if (loaded.kind === 'error') return null;
  return {
    parlay: loaded.parlay,
    analysis: scenario === 'error' ? null : loaded.analysis,
    combinedOdds: liveCombinedOdds(loaded.parlay.legs),
    structural: detectStructuralDependencies(loaded.parlay.legs),
    extractionStatusLabel:
      scenario === 'error' ? 'Extract failed' : EXTRACTION_STAGE_COPY[loaded.parlay.extractionStatus],
    analysisStageCopy:
      scenario === 'error'
        ? 'Preview extract failed. No screenshot was sent to a provider.'
        : 'Preview fixture. No screenshot was sent to a provider.',
  };
}

export function landingPreviewWowy(scenario: PreviewScenario): LandingWowyDemoScenario[] {
  if (scenario === 'empty' || scenario === 'error') return [];
  const subject = PREVIEW_PLAYERS[0];
  const mates = scenario === 'partial' ? [PREVIEW_PLAYERS[1]] : [PREVIEW_PLAYERS[1], PREVIEW_PLAYERS[4]];
  return mates.map((mate) => {
    const result = previewWowySummary({
      scenario,
      subjectPlayerId: subject.wowyId,
      teammatePlayerId: mate.wowyId,
      season: '2025',
      teamId: PREVIEW_TEAMS.herons.id,
      seasonType: 'regular',
    });
    const summary = (result.body as { summary: WowyPairSummary }).summary;
    return {
      id: mate.key,
      subjectName: playerDisplayName(subject, scenario),
      subjectNbaId: String(subject.playerId),
      teammateName: playerDisplayName(mate, scenario),
      teammateNbaId: String(mate.playerId),
      seasonLabel: '2025-26',
      teamLabel: scenario === 'mobile-dense' ? PREVIEW_TEAMS.herons.denseName : 'HCH · preview stint',
      seasonTypeLabel: 'Regular season',
      summary,
    };
  });
}
