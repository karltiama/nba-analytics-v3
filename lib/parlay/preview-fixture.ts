/**
 * Shared product-preview fixture (STEP 14P.E8.5).
 * One X3F source for Props, XRay, and Workspace preview links.
 * Preview Workspace legs are built in-memory and must not write the live selection store.
 */

import { propsExplorerHref } from '@/lib/betting/research-journey';
import { adaptPropsExplorerOffer, type PropsExplorerOfferInput } from './adapt-props-explorer-offer';
import type { SelectedParlayLeg } from './selection';
import { PARLAY_WORKSPACE_HREF } from './selection';
import { parsePreviewScenario } from '@/lib/preview/scenario';
import {
  X3F_AWAY_ABBR,
  X3F_CUTOFF_AT,
  X3F_DATE_LABEL,
  X3F_GAME_ID,
  X3F_GROUND_TRUTH_LEGS,
  X3F_HISTORICAL_DATE,
  X3F_HOME_ABBR,
  X3F_NBA_PLAYER_ID_BY_PLAYER_ID,
  X3F_SLATE_LABEL,
} from '@/lib/parlay-xray/e2e/ground-truth';

export const PRODUCT_PREVIEW_HUB_HREF = '/admin/product-preview';
export const XRAY_REPLAY_PREVIEW_HREF = '/parlay-xray?preview=replay';
export const WORKSPACE_HISTORICAL_PREVIEW_HREF = `${PARLAY_WORKSPACE_HREF}?preview=historical`;

export const PROPS_HISTORICAL_PREVIEW_HREF = `${propsExplorerHref({
  date: X3F_HISTORICAL_DATE,
  gameId: X3F_GAME_ID,
})}&preview=historical`;

export const PRODUCT_PREVIEW_FIXTURE = {
  gameId: X3F_GAME_ID,
  dateEt: X3F_HISTORICAL_DATE,
  dateLabel: X3F_DATE_LABEL,
  slateLabel: X3F_SLATE_LABEL,
  dataMode: 'historical' as const,
  legCount: X3F_GROUND_TRUTH_LEGS.length,
  providerCalls: 'none' as const,
} as const;

function x3fPropsInput(row: (typeof X3F_GROUND_TRUTH_LEGS)[number]): PropsExplorerOfferInput {
  return {
    playerId: row.canonicalPlayerId,
    playerName: row.canonicalPlayerName,
    gameId: X3F_GAME_ID,
    propType: row.market,
    side: row.side,
    lineValue: row.requestedLine,
    sportsbook: 'DraftKings',
    oddsAmerican: row.closeOverOdds,
    snapshotAt: X3F_CUTOFF_AT,
    marketContext: 'historical',
    sourceTable: 'research.prop_decision_lines',
  };
}

/** Canonical 4-leg Workspace preview. Does not touch the live selection store. */
export function buildWorkspaceHistoricalPreviewLegs(): SelectedParlayLeg[] {
  return X3F_GROUND_TRUTH_LEGS.map((row) => {
    const result = adaptPropsExplorerOffer(x3fPropsInput(row));
    if (!result.ok) {
      throw new Error(`X3F preview adapter failed for ${row.id}: ${result.code}`);
    }
    return {
      offer: result.offer,
      gameLabel: X3F_SLATE_LABEL,
      nbaPlayerId: X3F_NBA_PLAYER_ID_BY_PLAYER_ID[row.canonicalPlayerId] ?? null,
      awayAbbr: X3F_AWAY_ABBR,
      homeAbbr: X3F_HOME_ABBR,
    };
  });
}

export function isWorkspaceHistoricalPreview(flag: string | null | undefined): boolean {
  return flag === 'historical';
}

export function isCertifiedXrayReplayPreview(flag: string | null | undefined): boolean {
  return flag === 'replay';
}

export function shouldSuppressProductPreviewAnalytics(
  flag: string | null | undefined
): boolean {
  return (
    isCertifiedXrayReplayPreview(flag) ||
    isWorkspaceHistoricalPreview(flag) ||
    flag === '1' ||
    flag === 'partial' ||
    flag === 'analysis' ||
    parsePreviewScenario(flag) != null
  );
}

export function contextualWorkspaceNavLabel(legCount: number): string | null {
  if (legCount <= 0) return null;
  return `Parlay · ${legCount}`;
}

export function contextualWorkspaceNavAriaLabel(legCount: number): string {
  const noun = legCount === 1 ? 'leg' : 'legs';
  return `Open Parlay Workspace, ${legCount} ${noun}`;
}
