import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { PREVIEW_GAMES, PREVIEW_SNAPSHOT_AT } from './catalog';
import { previewExplorerRows } from './props-fixture';
import type { PreviewScenario } from './scenario';

function toLeg(row: ReturnType<typeof previewExplorerRows>[number], snapshot: 'live' | 'historical'): SelectedParlayLeg {
  const game = PREVIEW_GAMES.find((item) => item.gameId === row.gameId);
  const result = adaptPropsExplorerOffer({
    playerId: row.playerId,
    playerName: row.playerName,
    gameId: String(row.gameId),
    propType: row.propType,
    side: row.side,
    lineValue: row.lineValue,
    sportsbook: row.sportsbook,
    oddsAmerican: row.oddsAmerican,
    snapshotAt: PREVIEW_SNAPSHOT_AT,
    marketContext: snapshot,
    sourceTable: snapshot === 'historical' ? 'research.prop_decision_lines' : 'analytics.player_props_current',
  });
  if (!result.ok) {
    throw new Error(`Preview workspace adapter failed for ${row.id}: ${result.code}`);
  }
  return {
    offer: result.offer,
    gameLabel: game ? `${game.awayKey} @ ${game.homeKey}` : 'Preview',
  };
}

export function workspaceLegsForScenario(scenario: PreviewScenario): SelectedParlayLeg[] {
  const rows = previewExplorerRows(scenario === 'empty' || scenario === 'error' ? 'default' : scenario).filter(
    (row) => row.oddsAmerican != null
  );
  if (scenario === 'empty') return [];
  if (scenario === 'partial') {
    const first = previewExplorerRows('default')[0];
    const second = previewExplorerRows('default')[1];
    if (!first || !second) return [];
    return [toLeg(first, 'historical'), toLeg(second, 'live')];
  }
  const count = scenario === 'mobile-dense' ? 5 : scenario === 'default' || scenario === 'error' ? 3 : rows.length;
  return rows.slice(0, count).map((row) => toLeg(row, 'historical'));
}

export function workspacePreviewExplorerHref(scenario: PreviewScenario): string {
  const game = PREVIEW_GAMES[0];
  return `/betting/props-explorer?date=2026-04-02&game_id=${game.gameId}&preview=${scenario}`;
}
