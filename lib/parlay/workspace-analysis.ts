/**
 * Workspace historical analysis eligibility + adapter.
 * Does not fuzzy-resolve names. Does not invent dates or live context.
 */

import { toCanonicalParlayLegResolution } from './adapt-props-explorer-offer';
import { X3F_GAME_ID } from '@/lib/parlay-xray/e2e/ground-truth';
import { runHistoricalCanonicalParlayAnalysis } from '@/lib/parlay-xray/e2e/run';
import { interpretXrayParlay } from '@/lib/parlay-xray/interpretation/parlay';
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
  'TOO_MANY_GAMES',
  'MISSING_IDENTITY',
  'OUTSIDE_COVERAGE',
  'RESEARCH_SNAPSHOT',
] as const;

/** Current-props analysis loads one context per game; this caps the DB work per request. */
export const WORKSPACE_CURRENT_MAX_GAMES = 6;

export type WorkspaceAnalysisBlockCode = (typeof WORKSPACE_ANALYSIS_BLOCK_CODES)[number];

export type WorkspaceAnalysisBlock = {
  code: WorkspaceAnalysisBlockCode;
  message: string;
};

/** `historical`: certified fixture replay. `current`: today's props, context loaded from the DB as of now. */
export type WorkspaceAnalysisRunMode = 'historical' | 'current';

export type WorkspaceAnalysisEligibility =
  | { status: 'READY'; gameId: string; gameIds: string[]; mode: WorkspaceAnalysisRunMode; reasons: [] }
  | { status: 'UNAVAILABLE'; reasons: WorkspaceAnalysisBlock[] };

export type WorkspaceAnalysisOptions = {
  /**
   * Server flag `PARLAY_WORKSPACE_CURRENT_ANALYSIS_ENABLED=1`. Default off: live_current legs stay
   * blocked with LIVE_CURRENT. Entitlement `CURRENT_LIVE_ANALYSIS` is still NOT_READY.
   */
  currentAnalysisEnabled?: boolean;
};

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
  legs: SelectedParlayLeg[],
  options: WorkspaceAnalysisOptions = {}
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
  const gameId = [...gameIds][0] ?? '';

  if (snapshots.has('research_snapshot')) {
    reasons.push({
      code: 'RESEARCH_SNAPSHOT',
      message:
        snapshots.size === 1
          ? 'Current contextual analysis is unavailable for a Research Snapshot.'
          : 'Research Snapshot legs cannot be mixed with another snapshot.',
    });
  } else {
  if (snapshots.has('live_current') && !options.currentAnalysisEnabled) {
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

  // Current props load context per game, so they may span games. The certified historical
  // fixture covers one game only.
  const currentMode = snapshots.has('live_current') && Boolean(options.currentAnalysisEnabled);
  if (gameIds.size > 1 && !currentMode) {
    reasons.push({
      code: 'MULTI_GAME',
      message: 'Historical Court Context analysis currently supports parlays from one game.',
    });
  }
  if (currentMode && gameIds.size > WORKSPACE_CURRENT_MAX_GAMES) {
    reasons.push({
      code: 'TOO_MANY_GAMES',
      message: `Court Context analysis supports parlays from up to ${WORKSPACE_CURRENT_MAX_GAMES} games.`,
    });
  }

  const historicalOnly = [...snapshots].every((kind) => kind === 'decision_close');
  if (historicalOnly && gameId && gameId !== WORKSPACE_HISTORICAL_ANALYSIS_GAME_ID) {
    reasons.push({
      code: 'OUTSIDE_COVERAGE',
      message: 'Historical Court Context analysis is not available for one or more selected offers.',
    });
  }
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

  const unique = uniqueReasons(reasons);
  if (unique.length > 0) return { status: 'UNAVAILABLE', reasons: unique };
  const mode: WorkspaceAnalysisRunMode = snapshots.has('live_current') ? 'current' : 'historical';
  return { status: 'READY', gameId, gameIds: [...gameIds], mode, reasons: [] };
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
  deps: HistoricalXrayReplayDeps,
  options: WorkspaceAnalysisOptions = {}
): HistoricalXrayReplayResult {
  const eligibility = evaluateWorkspaceAnalysisEligibility(legs, options);
  if (eligibility.status !== 'READY') {
    throw new Error(`WORKSPACE_ANALYSIS_${eligibility.reasons[0]?.code ?? 'UNAVAILABLE'}`);
  }
  if (context.gameId !== eligibility.gameId) {
    throw new Error('WORKSPACE_ANALYSIS_GAME_MISMATCH');
  }
  // A current-props context must never be paired with historical legs, or the reverse.
  if ((context.analysisMode === 'current') !== (eligibility.mode === 'current')) {
    throw new Error('WORKSPACE_ANALYSIS_MODE_MISMATCH');
  }

  const t0 = deps.nowMs?.() ?? 0;
  const resolutions = resolutionsFromWorkspaceSelection(legs, deps.catalog).map((row) =>
    attachMatchupFromReplayDeps(row, deps)
  );
  const adapterMs = Math.max(0, (deps.nowMs?.() ?? t0) - t0);
  return runHistoricalCanonicalParlayAnalysis(resolutions, context, deps, { resolveMs: adapterMs });
}

/** One game's current-props context, as served by POST /api/parlay-workspace/context. */
export type WorkspaceGameReplay = {
  context: HistoricalXrayReplayContext;
  deps: HistoricalXrayReplayDeps;
};

/**
 * Current-props analysis across one or more games. Each game's legs run against that game's
 * context (target game, cutoff, sources); per-leg results are put back in slip order and the
 * parlay-level read is computed once over every leg, so shared-game groups stay per game.
 */
export function runWorkspaceCurrentGamesAnalysis(
  legs: SelectedParlayLeg[],
  replays: WorkspaceGameReplay[],
  options: WorkspaceAnalysisOptions = {}
): HistoricalXrayReplayResult {
  const eligibility = evaluateWorkspaceAnalysisEligibility(legs, { ...options, currentAnalysisEnabled: true });
  if (eligibility.status !== 'READY') {
    throw new Error(`WORKSPACE_ANALYSIS_${eligibility.reasons[0]?.code ?? 'UNAVAILABLE'}`);
  }
  if (eligibility.mode !== 'current') throw new Error('WORKSPACE_ANALYSIS_MODE_MISMATCH');

  const groups = eligibility.gameIds.map((gameId) => {
    const replay = replays.find((row) => row.context.gameId === gameId);
    if (!replay) throw new Error('WORKSPACE_ANALYSIS_GAME_MISMATCH');
    const indexes = legs.flatMap((leg, index) => (leg.offer.gameId === gameId ? [index] : []));
    const result = runWorkspaceHistoricalAnalysis(
      indexes.map((index) => legs[index]!),
      replay.context,
      replay.deps,
      { currentAnalysisEnabled: true }
    );
    return { replay, indexes, result };
  });
  if (groups.length === 1) return groups[0]!.result;

  const slot = new Map<number, { result: HistoricalXrayReplayResult; at: number }>();
  for (const group of groups) {
    group.indexes.forEach((legIndex, at) => slot.set(legIndex, { result: group.result, at }));
  }
  const pick = <K extends 'confirmedLegs' | 'resolutions' | 'matches' | 'contexts' | 'interpretations' | 'identityLayers'>(
    key: K
  ): HistoricalXrayReplayResult[K] =>
    legs.map((_, index) => {
      const hit = slot.get(index)!;
      return hit.result[key][hit.at];
    }) as HistoricalXrayReplayResult[K];

  const interpretations = pick('interpretations');
  const first = groups[0]!.replay.context;
  const cutoffAt = groups
    .map((group) => group.replay.context.cutoffAt)
    .reduce((min, value) => (Date.parse(value) < Date.parse(min) ? value : min));
  const sum = (key: keyof HistoricalXrayReplayResult['timings']) =>
    groups.reduce((total, group) => total + group.result.timings[key], 0);

  return {
    confirmedLegs: pick('confirmedLegs'),
    resolutions: pick('resolutions'),
    matches: pick('matches'),
    contexts: pick('contexts'),
    interpretations,
    parlayInterpretation: interpretXrayParlay(interpretations),
    historicalReplay: {
      cutoffAt,
      dateLabel: `${first.dateLabel} · ${groups.map((group) => group.replay.context.slateLabel).join(', ')}`,
      gameId: first.gameId,
    },
    identityLayers: pick('identityLayers'),
    timings: {
      resolveMs: sum('resolveMs'),
      matchMs: sum('matchMs'),
      contextMs: sum('contextMs'),
      interpretMs: sum('interpretMs'),
      totalMs: sum('totalMs'),
    },
  };
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
