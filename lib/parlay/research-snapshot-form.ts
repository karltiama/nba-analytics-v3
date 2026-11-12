/**
 * Historical player form for a Research Snapshot ticket.
 * Uses each leg's observation time as the cutoff. Does not read prices, injuries, or projections.
 * A prior game counts only when it started before that observation, the game status is Final,
 * and the box-score row was first stored before that observation.
 * There is no official end time. created_at is the first insert, not a guarantee that later
 * corrections left the numbers unchanged.
 */

import type { CanonicalPropType } from '@/lib/betting/market-movement';
import { isUsablePriorRow } from '@/lib/parlay-xray/context/cutoff';
import { assemblePlayerForm } from '@/lib/parlay-xray/context/player-form';
import { assembleRole } from '@/lib/parlay-xray/context/role';
import { selectPriorLogs } from '@/lib/parlay-xray/context/stats';
import type { XrayPriorPlayerLog } from '@/lib/parlay-xray/context/types';
import { XRAY_CANONICAL_MARKETS } from '@/lib/parlay-xray/resolution/types';
import type { SelectedParlayLeg } from './selection';

export const RESEARCH_SNAPSHOT_FORM_MAX_LEGS = 4;
export const RESEARCH_SNAPSHOT_FORM_MAX_GAMES = 4;
export const RESEARCH_SNAPSHOT_FORM_MAX_LOGS = 200;

export const HISTORICAL_PLAYER_FORM_TITLE = 'Historical Player Form';
export const HISTORICAL_PLAYER_FORM_COPY =
  'Based on final box scores first stored before the sportsbook price was observed.';
export const HISTORICAL_PLAYER_FORM_BASIS =
  'A game counts when it started before the observation, its status is Final, and its box-score row was first stored before the observation. There is no official end time. A later correction can still change a stored row. Games with no first-stored time are left out.';
export const FULL_COURT_CONTEXT_UNAVAILABLE_HEADING = 'Full Court Context analysis is not available';
export const RESEARCH_SNAPSHOT_WORKSPACE_NOTE =
  'Full Court Context analysis is not available for a Research Snapshot. Historical Player Form is the research for this ticket.';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MARKETS = new Set<string>(XRAY_CANONICAL_MARKETS);

export type ResearchSnapshotFormWindow = {
  gameCount: number;
  average: number | null;
};

export type ResearchSnapshotFormLineRelative = {
  sampleCount: number;
  above: number;
  below: number;
  equal: number;
};

export type ResearchSnapshotFormRequestLeg = {
  playerId: string;
  gameId: string;
  market: CanonicalPropType;
  side: 'over' | 'under';
  line: number;
  snapshotAt: string;
};

export type ResearchSnapshotScheduledGame = {
  homeAbbr: string;
  awayAbbr: string;
  startTime: string;
};

export type ResearchSnapshotTeamAssignment =
  | {
      status: 'resolved';
      playerTeamAbbr: string;
      opponentAbbr: string;
      provenance: 'most_recent_final_box_score_stored_before_observation';
    }
  | { status: 'unresolved' };

export type ResearchSnapshotFormLegResult = {
  playerId: string;
  gameId: string;
  market: CanonicalPropType;
  side: 'over' | 'under';
  line: number;
  snapshotAt: string;
  status: 'ready' | 'unavailable';
  reason: string | null;
  cutoffAt: string | null;
  scheduledGame: ResearchSnapshotScheduledGame | null;
  teamAssignment: ResearchSnapshotTeamAssignment;
  season: ResearchSnapshotFormWindow | null;
  last5: ResearchSnapshotFormWindow | null;
  last10: ResearchSnapshotFormWindow | null;
  lineRelative: ResearchSnapshotFormLineRelative | null;
  minutes: {
    priorGame: number | null;
    season: ResearchSnapshotFormWindow;
    last5: ResearchSnapshotFormWindow;
    last10: ResearchSnapshotFormWindow;
    gamesPlayed: number;
  } | null;
};

export type ResearchSnapshotPriorLog = XrayPriorPlayerLog & {
  gameStatus: string | null;
  boxScoreStoredAt: string | null;
};

export type ResearchSnapshotFormSources = {
  scheduledGame: ResearchSnapshotScheduledGame & {
    season: string | null;
    homeTeamId: string;
    awayTeamId: string;
  };
  logs: ResearchSnapshotPriorLog[];
};

const REASONS = {
  NO_PRIOR_GAMES: 'No final box score stored before this observation is available.',
  UNSUPPORTED_MARKET: 'This market is not supported for historical player form.',
  ROW_LIMIT: 'Too many prior games were returned to summarize safely.',
  GAME_NOT_FOUND: 'The scheduled game for this leg was not found.',
  SOURCE_UNAVAILABLE: 'Historical game logs could not be read for this leg.',
  SMALL_PRIOR_SAMPLE: 'Fewer than 10 logged games are available before this observation.',
} as const;

export function researchSnapshotFormReason(code: keyof typeof REASONS): string {
  return REASONS[code];
}

export function parseResearchSnapshotFormRequest(
  body: unknown
): { ok: true; legs: ResearchSnapshotFormRequestLeg[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { legs?: unknown }).legs)) {
    return { ok: false, error: 'Invalid historical form request.' };
  }
  const rawLegs = (body as { legs: unknown[] }).legs;
  if (rawLegs.length === 0) return { ok: false, error: 'Invalid historical form request.' };
  if (rawLegs.length > RESEARCH_SNAPSHOT_FORM_MAX_LEGS) {
    return { ok: false, error: 'Too many legs for historical player form.' };
  }
  const legs: ResearchSnapshotFormRequestLeg[] = [];
  for (const raw of rawLegs) {
    const parsed = parseLeg(raw);
    if (!parsed) return { ok: false, error: 'Invalid historical form request.' };
    legs.push(parsed);
  }
  if (new Set(legs.map((leg) => leg.gameId)).size > RESEARCH_SNAPSHOT_FORM_MAX_GAMES) {
    return { ok: false, error: 'Too many games for historical player form.' };
  }
  return { ok: true, legs };
}

export function researchSnapshotFormRequestFromSelection(
  legs: readonly SelectedParlayLeg[]
): ResearchSnapshotFormRequestLeg[] | null {
  if (legs.length === 0 || legs.length > RESEARCH_SNAPSHOT_FORM_MAX_LEGS) return null;
  if (!legs.every((leg) => leg.offer.snapshotKind === 'research_snapshot')) return null;
  const parsed = parseResearchSnapshotFormRequest({
    legs: legs.map((leg) => ({
      playerId: leg.offer.playerId,
      gameId: leg.offer.gameId,
      market: leg.offer.market,
      side: leg.offer.side,
      line: leg.offer.line,
      snapshotAt: leg.offer.snapshotAt,
    })),
  });
  return parsed.ok ? parsed.legs : null;
}

export function researchSnapshotFormKey(legs: readonly ResearchSnapshotFormRequestLeg[]): string {
  return legs
    .map((leg) => [leg.playerId, leg.gameId, leg.market, leg.side, String(leg.line), leg.snapshotAt].join('|'))
    .join('\n');
}

export function researchSnapshotFormResponseMatches(
  request: readonly ResearchSnapshotFormRequestLeg[],
  results:
    | readonly Pick<ResearchSnapshotFormLegResult, 'playerId' | 'gameId' | 'market' | 'side' | 'line' | 'snapshotAt'>[]
    | null
    | undefined
): boolean {
  if (!results || results.length !== request.length) return false;
  return request.every((leg, index) => {
    const result = results[index];
    return (
      result.playerId === leg.playerId &&
      result.gameId === leg.gameId &&
      result.market === leg.market &&
      result.side === leg.side &&
      result.line === leg.line &&
      result.snapshotAt === leg.snapshotAt
    );
  });
}

export function researchSnapshotLogEligible(
  log: ResearchSnapshotPriorLog,
  args: { playerId: string; cutoffAt: string; targetGameId: string }
): boolean {
  if (log.playerId !== args.playerId) return false;
  if (
    !isUsablePriorRow({
      gameId: log.gameId,
      startTime: log.startTime,
      cutoffAt: args.cutoffAt,
      targetGameId: args.targetGameId,
    })
  ) {
    return false;
  }
  if ((log.gameStatus ?? '').trim().toLowerCase() !== 'final') return false;
  const storedMs = Date.parse(log.boxScoreStoredAt ?? '');
  const cutoffMs = Date.parse(args.cutoffAt);
  if (!Number.isFinite(storedMs) || !Number.isFinite(cutoffMs)) return false;
  return storedMs < cutoffMs;
}

function eligibleResearchSnapshotLogs(
  leg: ResearchSnapshotFormRequestLeg,
  logs: readonly ResearchSnapshotPriorLog[]
): ResearchSnapshotPriorLog[] {
  return logs.filter((log) =>
    researchSnapshotLogEligible(log, {
      playerId: leg.playerId,
      cutoffAt: leg.snapshotAt,
      targetGameId: leg.gameId,
    })
  );
}

export function formatSampleAverage(average: number | null, gameCount: number): string | null {
  if (gameCount <= 0 || average == null) return null;
  return `${average} over ${gameCount === 1 ? '1 game' : `${gameCount} games`}`;
}

export function assembleResearchSnapshotFormLeg(
  leg: ResearchSnapshotFormRequestLeg,
  sources: ResearchSnapshotFormSources | null,
  options: { rowLimit?: boolean; sourceFailed?: boolean } = {}
): ResearchSnapshotFormLegResult {
  const base = emptyResult(leg);
  if (options.sourceFailed) return { ...base, reason: REASONS.SOURCE_UNAVAILABLE };
  if (!sources) {
    return {
      ...base,
      cutoffAt: options.rowLimit ? leg.snapshotAt : null,
      reason: options.rowLimit ? REASONS.ROW_LIMIT : REASONS.GAME_NOT_FOUND,
    };
  }
  if (!MARKETS.has(leg.market)) return { ...base, reason: REASONS.UNSUPPORTED_MARKET };
  if (options.rowLimit || sources.logs.length > RESEARCH_SNAPSHOT_FORM_MAX_LOGS) {
    return {
      ...base,
      cutoffAt: leg.snapshotAt,
      scheduledGame: scheduledGameOf(sources),
      reason: REASONS.ROW_LIMIT,
    };
  }

  const logs = eligibleResearchSnapshotLogs(leg, sources.logs);
  const form = assemblePlayerForm({
    logs,
    playerId: leg.playerId,
    cutoffAt: leg.snapshotAt,
    targetGameId: leg.gameId,
    season: sources.scheduledGame.season,
    market: leg.market,
    requestedLine: leg.line,
  });
  const role = assembleRole({
    logs,
    playerId: leg.playerId,
    cutoffAt: leg.snapshotAt,
    targetGameId: leg.gameId,
    season: sources.scheduledGame.season,
  });
  const scheduledGame = scheduledGameOf(sources);
  const teamAssignment = teamFromPriorLog(leg, { ...sources, logs });
  if (form.status === 'UNAVAILABLE' && role.status === 'UNAVAILABLE') {
    return {
      ...base,
      cutoffAt: leg.snapshotAt,
      scheduledGame,
      teamAssignment,
      reason: form.reason === 'MARKET_UNRESOLVED' ? REASONS.UNSUPPORTED_MARKET : REASONS.NO_PRIOR_GAMES,
    };
  }

  return {
    ...base,
    status: 'ready',
    reason: form.status === 'LIMITED' || role.status === 'LIMITED' ? REASONS.SMALL_PRIOR_SAMPLE : null,
    cutoffAt: leg.snapshotAt,
    scheduledGame,
    teamAssignment,
    season: form.status === 'UNAVAILABLE' ? null : form.seasonToDate,
    last5: form.status === 'UNAVAILABLE' ? null : form.last5,
    last10: form.status === 'UNAVAILABLE' ? null : form.last10,
    lineRelative:
      form.status === 'UNAVAILABLE'
        ? null
        : {
            sampleCount: form.lineRelative.sampleCount,
            above: form.lineRelative.aboveRequestedLine,
            below: form.lineRelative.belowRequestedLine,
            equal: form.lineRelative.equalRequestedLine,
          },
    minutes:
      role.status === 'UNAVAILABLE'
        ? null
        : {
            priorGame: role.priorGameMinutes,
            season: role.seasonToDateMinutes,
            last5: role.last5Minutes,
            last10: role.last10Minutes,
            gamesPlayed: role.gamesPlayed,
          },
  };
}

function teamFromPriorLog(
  leg: ResearchSnapshotFormRequestLeg,
  sources: ResearchSnapshotFormSources
): ResearchSnapshotTeamAssignment {
  const priors = selectPriorLogs(sources.logs, {
    playerId: leg.playerId,
    cutoffAt: leg.snapshotAt,
    targetGameId: leg.gameId,
  });
  const teamId = priors.find((log) => log.teamId)?.teamId ?? null;
  const game = sources.scheduledGame;
  if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) return { status: 'unresolved' };
  const playerIsHome = teamId === game.homeTeamId;
  return {
    status: 'resolved',
    playerTeamAbbr: playerIsHome ? game.homeAbbr : game.awayAbbr,
    opponentAbbr: playerIsHome ? game.awayAbbr : game.homeAbbr,
    provenance: 'most_recent_final_box_score_stored_before_observation',
  };
}

function scheduledGameOf(sources: ResearchSnapshotFormSources): ResearchSnapshotScheduledGame {
  return {
    homeAbbr: sources.scheduledGame.homeAbbr,
    awayAbbr: sources.scheduledGame.awayAbbr,
    startTime: sources.scheduledGame.startTime,
  };
}

function emptyResult(leg: ResearchSnapshotFormRequestLeg): ResearchSnapshotFormLegResult {
  return {
    playerId: leg.playerId,
    gameId: leg.gameId,
    market: leg.market,
    side: leg.side,
    line: leg.line,
    snapshotAt: leg.snapshotAt,
    status: 'unavailable',
    reason: null,
    cutoffAt: null,
    scheduledGame: null,
    teamAssignment: { status: 'unresolved' },
    season: null,
    last5: null,
    last10: null,
    lineRelative: null,
    minutes: null,
  };
}

function parseLeg(raw: unknown): ResearchSnapshotFormRequestLeg | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.playerId !== 'string' || !ID.test(row.playerId)) return null;
  if (typeof row.gameId !== 'string' || !ID.test(row.gameId)) return null;
  if (typeof row.market !== 'string' || !MARKETS.has(row.market)) return null;
  if (row.side !== 'over' && row.side !== 'under') return null;
  if (typeof row.line !== 'number' || !Number.isFinite(row.line) || row.line < 0 || row.line > 200) return null;
  if (typeof row.snapshotAt !== 'string') return null;
  const snapshotAt = normalizeObservedAt(row.snapshotAt);
  if (!snapshotAt) return null;
  return {
    playerId: row.playerId,
    gameId: row.gameId,
    market: row.market as CanonicalPropType,
    side: row.side,
    line: row.line,
    snapshotAt,
  };
}

/** Same acceptance as the handoff: a finite timestamp. Normalized so the cutoff is one instant. */
export function normalizeObservedAt(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
