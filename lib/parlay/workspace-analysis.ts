/**
 * Workspace historical analysis eligibility + adapter.
 * Does not fuzzy-resolve names. Does not invent dates or live context.
 */

import { toCanonicalParlayLegResolution } from './adapt-props-explorer-offer';
import { X3F_GAME_ID } from '@/lib/parlay-xray/e2e/ground-truth';
import { runHistoricalCanonicalParlayAnalysis } from '@/lib/parlay-xray/e2e/run';
import type {
  HistoricalXrayReplayContext,
  HistoricalXrayReplayDeps,
  HistoricalXrayReplayResult,
} from '@/lib/parlay-xray/e2e/types';
import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import type { SelectedParlayLeg } from './selection';

/** Documented XRay historical matching audit window. Not full-season availability. */
export const CERTIFIED_HISTORICAL_PROP_COVERAGE = {
  start: '2026-04-02',
  end: '2026-05-02',
} as const;

/** E4 runtime injects certified X3F deps only. Other coverage dates need SQL loaders (not wired). */
export const WORKSPACE_HISTORICAL_ANALYSIS_GAME_ID = X3F_GAME_ID;

export const WORKSPACE_ANALYSIS_BLOCK_CODES = [
  'EMPTY',
  'LIVE_CURRENT',
  'MIXED_SNAPSHOT',
  'MULTI_GAME',
  'MISSING_IDENTITY',
  'OUTSIDE_COVERAGE',
] as const;

export type WorkspaceAnalysisBlockCode = (typeof WORKSPACE_ANALYSIS_BLOCK_CODES)[number];

export type WorkspaceAnalysisBlock = {
  code: WorkspaceAnalysisBlockCode;
  message: string;
};

export type WorkspaceAnalysisEligibility =
  | { status: 'READY'; gameId: string; reasons: [] }
  | { status: 'UNAVAILABLE'; reasons: WorkspaceAnalysisBlock[] };

export function selectionFingerprint(legs: SelectedParlayLeg[]): string {
  return legs
    .map((leg) => leg.offer.offerIdentity)
    .slice()
    .sort()
    .join('\n');
}

export function resolutionsFromWorkspaceSelection(
  legs: SelectedParlayLeg[],
  catalog?: Parameters<typeof toCanonicalParlayLegResolution>[1]
): CanonicalParlayLegResolution[] {
  return legs.map((leg) => {
    const resolution = toCanonicalParlayLegResolution(leg.offer, catalog);
    const ocrSnippet = leg.xrayProvenance?.ocrSnippet ?? null;
    if (!ocrSnippet) return resolution;
    return {
      ...resolution,
      originalLeg: { ...resolution.originalLeg, rawSnippet: ocrSnippet },
    };
  });
}

export function evaluateWorkspaceAnalysisEligibility(
  legs: SelectedParlayLeg[]
): WorkspaceAnalysisEligibility {
  if (legs.length === 0) {
    return {
      status: 'UNAVAILABLE',
      reasons: [
        {
          code: 'EMPTY',
          message: 'Your parlay is empty. Explore props to add your first leg.',
        },
      ],
    };
  }

  const reasons: WorkspaceAnalysisBlock[] = [];
  const snapshots = new Set(legs.map((leg) => leg.offer.snapshotKind));
  const gameIds = new Set(legs.map((leg) => leg.offer.gameId));

  if (snapshots.has('live_current')) {
    reasons.push({
      code: 'LIVE_CURRENT',
      message: 'Current-season Court Context analysis is not enabled yet.',
    });
  }

  if (snapshots.size > 1) {
    reasons.push({
      code: 'MIXED_SNAPSHOT',
      message: 'Selected offers mix historical Decision Close with another snapshot. Historical analysis needs one snapshot kind.',
    });
  }

  if (![...snapshots].every((kind) => kind === 'decision_close' || kind === 'live_current')) {
    reasons.push({
      code: 'MIXED_SNAPSHOT',
      message: 'Historical analysis only accepts Decision Close offers.',
    });
  }

  if (snapshots.has('shared_snapshot')) {
    reasons.push({
      code: 'MIXED_SNAPSHOT',
      message:
        'Shared snapshot legs keep historical share prices. Re-select live or Decision Close offers to analyze.',
    });
  }

  if (gameIds.size > 1) {
    reasons.push({
      code: 'MULTI_GAME',
      message: 'Historical Court Context analysis currently supports parlays from one game.',
    });
  }

  for (const leg of legs) {
    const offer = leg.offer;
    if (!offer.playerId.trim() || !offer.gameId.trim() || offer.sportsbook.vendor.trim() === '') {
      reasons.push({
        code: 'MISSING_IDENTITY',
        message: 'A selected offer is missing required player, game, or sportsbook identity.',
      });
      break;
    }
  }

  const gameId = [...gameIds][0] ?? '';
  const historicalOnly = [...snapshots].every((kind) => kind === 'decision_close');
  if (historicalOnly && gameId && gameId !== WORKSPACE_HISTORICAL_ANALYSIS_GAME_ID) {
    reasons.push({
      code: 'OUTSIDE_COVERAGE',
      message: 'Historical Court Context analysis is not available for one or more selected offers.',
    });
  }

  const unique = uniqueReasons(reasons);
  if (unique.length > 0) return { status: 'UNAVAILABLE', reasons: unique };
  return { status: 'READY', gameId, reasons: [] };
}

function uniqueReasons(reasons: WorkspaceAnalysisBlock[]): WorkspaceAnalysisBlock[] {
  const seen = new Set<string>();
  const out: WorkspaceAnalysisBlock[] = [];
  for (const reason of reasons) {
    const key = `${reason.code}:${reason.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

export function runWorkspaceHistoricalAnalysis(
  legs: SelectedParlayLeg[],
  context: HistoricalXrayReplayContext,
  deps: HistoricalXrayReplayDeps
): HistoricalXrayReplayResult {
  const eligibility = evaluateWorkspaceAnalysisEligibility(legs);
  if (eligibility.status !== 'READY') {
    throw new Error(`WORKSPACE_ANALYSIS_${eligibility.reasons[0]?.code ?? 'UNAVAILABLE'}`);
  }
  if (context.gameId !== eligibility.gameId) {
    throw new Error('WORKSPACE_ANALYSIS_GAME_MISMATCH');
  }

  const t0 = deps.nowMs?.() ?? 0;
  const resolutions = resolutionsFromWorkspaceSelection(legs, deps.catalog).map((row) =>
    attachMatchupFromReplayDeps(row, deps)
  );
  const adapterMs = Math.max(0, (deps.nowMs?.() ?? t0) - t0);
  return runHistoricalCanonicalParlayAnalysis(resolutions, context, deps, { resolveMs: adapterMs });
}

function attachMatchupFromReplayDeps(
  resolution: CanonicalParlayLegResolution,
  deps: HistoricalXrayReplayDeps
): CanonicalParlayLegResolution {
  const target = deps.targetGame;
  const playerId = resolution.playerResolution.value?.playerId ?? null;
  const logs = (playerId && deps.sourcesByPlayerId[playerId]?.priorPlayerLogs) || [];
  const teamId = logs.find((row) => row.teamId)?.teamId ?? null;
  const gameValue = {
    gameId: resolution.gameResolution.value?.gameId || target.gameId,
    startTime: target.startTime || resolution.gameResolution.value?.startTime || '',
    homeTeamAbbr: target.homeAbbr,
    awayTeamAbbr: target.awayAbbr,
  };

  let teamResolution = resolution.teamResolution;
  let opponentResolution = resolution.opponentResolution;
  if (teamId === target.homeTeamId || teamId === target.awayTeamId) {
    const isHome = teamId === target.homeTeamId;
    const teamAbbr = isHome ? target.homeAbbr : target.awayAbbr;
    const oppAbbr = isHome ? target.awayAbbr : target.homeAbbr;
    const oppId = isHome ? target.awayTeamId : target.homeTeamId;
    teamResolution = {
      status: 'RESOLVED',
      value: { abbreviation: teamAbbr, teamId },
      extracted: teamAbbr,
      reason: null,
    };
    opponentResolution = {
      status: 'RESOLVED',
      value: { abbreviation: oppAbbr, teamId: oppId },
      extracted: oppAbbr,
      reason: null,
    };
  }

  return {
    ...resolution,
    teamResolution,
    opponentResolution,
    gameResolution: {
      ...resolution.gameResolution,
      value: gameValue,
      candidates: [gameValue],
    },
  };
}
