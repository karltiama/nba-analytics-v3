/**
 * Fail-closed season-phase readiness for a consumer's upcoming operating horizon.
 *
 * Authority: analytics.games labels written by game-status-sync from archived BDL responses.
 * Optional provider evidence (classified rows from an archived, untruncated /v1/games pull that
 * covers the whole horizon) is the only way to detect games missing from the database, and the
 * only way an empty horizon can be ready. Nothing here infers a phase from dates or game ids.
 */

import { SERVING_SEASON_PHASES, etDateOfInstant, servingDateDecision } from './season-eligibility';
import { SEASON_PHASES, type SeasonPhaseClassification } from './season-phase';
import { etYmd, shiftEtYmd, STATUS_SYNC_FREQUENT_LOOKAHEAD_DAYS } from './status-sync-query';

/** Phase sources that come from provider evidence. `none` and the bare postseason flag never qualify. */
export const READINESS_PHASE_SOURCES: ReadonlySet<string> = new Set(['request_season_type', 'provider_ist_stage']);

/** Today ET through today + status-sync lookahead: the dates scheduled status-sync labels every cycle. */
export const OPERATING_HORIZON_DAYS_AHEAD = STATUS_SYNC_FREQUENT_LOOKAHEAD_DAYS;

export type ReadinessHorizon = {
  season: string;
  /** Inclusive America/New_York dates. */
  startDate: string;
  endDate: string;
};

export type ReadinessGameRow = {
  gameId: string;
  season: string;
  startTime: string | null;
  seasonPhase: string | null;
  seasonPhaseSource: string | null;
};

export type ProviderScheduleEvidence = {
  startDate: string;
  endDate: string;
  /** False when any query hit its page cap or any page was not archived. */
  complete: boolean;
  games: Array<{ gameId: string; etDate: string | null; phase: SeasonPhaseClassification }>;
};

export type IneligibleReason =
  | 'preseason'
  | 'unknown_phase'
  | 'unsupported_phase_source'
  | 'season_mismatch'
  | 'invalid_game_date'
  | 'before_regular_season_open'
  | 'nba_cup_final'
  | 'season_open_unknown'
  | 'season_type_not_requested'
  | 'season_type_not_serving';

/** Integrity anomalies block readiness; the rest are legitimate exclusions. */
const BLOCKING_INELIGIBLE: ReadonlySet<IneligibleReason> = new Set([
  'unknown_phase',
  'unsupported_phase_source',
  'invalid_game_date',
  'season_open_unknown',
]);

export type SeasonPhaseReadiness = {
  ready: boolean;
  horizon: ReadinessHorizon;
  coverage: 'provider_verified' | 'db_only';
  reasons: string[];
  warnings: string[];
  eligible: string[];
  unclassified: string[];
  ineligible: Array<{ gameId: string; reason: IneligibleReason }>;
  missing: Array<{ gameId: string; etDate: string | null; phase: string }>;
};

export function operatingHorizon(season: string, now: Date): ReadinessHorizon {
  const today = etYmd(now);
  return { season, startDate: today, endDate: shiftEtYmd(today, OPERATING_HORIZON_DAYS_AHEAD) };
}

function inHorizon(h: ReadinessHorizon, etDate: string | null): boolean {
  return etDate != null && etDate >= h.startDate && etDate <= h.endDate;
}

function classifyRow(
  h: ReadinessHorizon,
  row: ReadinessGameRow,
  cupFinalIds: ReadonlySet<string>
): { kind: 'eligible' } | { kind: 'unclassified' } | { kind: 'ineligible'; reason: IneligibleReason } {
  if (row.season !== h.season) return { kind: 'ineligible', reason: 'season_mismatch' };
  const phase = row.seasonPhase;
  if (phase == null || phase === 'UNCLASSIFIED') return { kind: 'unclassified' };
  if (!(SEASON_PHASES as readonly string[]).includes(phase)) return { kind: 'ineligible', reason: 'unknown_phase' };
  if (phase === 'PRESEASON') return { kind: 'ineligible', reason: 'preseason' };
  if (!SERVING_SEASON_PHASES.has(phase)) return { kind: 'ineligible', reason: 'unknown_phase' };
  if (!READINESS_PHASE_SOURCES.has(row.seasonPhaseSource ?? '')) {
    return { kind: 'ineligible', reason: 'unsupported_phase_source' };
  }
  if (cupFinalIds.has(row.gameId)) return { kind: 'ineligible', reason: 'nba_cup_final' };
  const decision = servingDateDecision(h.season, etDateOfInstant(row.startTime));
  if (!decision.eligible) return { kind: 'ineligible', reason: decision.reason };
  return { kind: 'eligible' };
}

/** Pure. `rows` should be every analytics.games row whose ET tip date falls in the horizon. */
export function evaluateSeasonPhaseReadiness(input: {
  horizon: ReadinessHorizon;
  rows: readonly ReadinessGameRow[];
  provider?: ProviderScheduleEvidence | null;
}): SeasonPhaseReadiness {
  const h = input.horizon;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const provider = input.provider ?? null;
  const providerCovers =
    provider != null && provider.complete && provider.startDate <= h.startDate && provider.endDate >= h.endDate;
  if (provider && !providerCovers) reasons.push('provider_evidence_incomplete_or_not_covering_horizon');

  const providerInHorizon = (provider?.games ?? []).filter((g) => inHorizon(h, g.etDate));
  const cupFinalIds = new Set(
    providerInHorizon
      .filter((g) => g.phase.phase === 'UNCLASSIFIED' && g.phase.source === 'provider_ist_stage')
      .map((g) => g.gameId)
  );

  const eligible: string[] = [];
  const unclassified: string[] = [];
  const ineligible: SeasonPhaseReadiness['ineligible'] = [];
  const dbIds = new Set<string>();
  for (const row of input.rows) {
    if (!inHorizon(h, etDateOfInstant(row.startTime))) continue;
    dbIds.add(row.gameId);
    const c = classifyRow(h, row, cupFinalIds);
    if (c.kind === 'eligible') eligible.push(row.gameId);
    else if (c.kind === 'unclassified') unclassified.push(row.gameId);
    else ineligible.push({ gameId: row.gameId, reason: c.reason });
  }

  const missing: SeasonPhaseReadiness['missing'] = [];
  if (providerCovers) {
    for (const g of providerInHorizon) {
      if (dbIds.has(g.gameId)) continue;
      if (!SERVING_SEASON_PHASES.has(g.phase.phase)) continue;
      if (!servingDateDecision(h.season, g.etDate).eligible) continue;
      missing.push({ gameId: g.gameId, etDate: g.etDate, phase: g.phase.phase });
    }
    const providerIds = new Set(providerInHorizon.map((g) => g.gameId));
    const notInProvider = eligible.filter((id) => !providerIds.has(id));
    if (notInProvider.length > 0) warnings.push(`eligible_rows_absent_from_provider_window:${notInProvider.join(',')}`);
  } else {
    warnings.push('missing_games_unverifiable_without_provider_evidence');
  }

  if (unclassified.length > 0) reasons.push(`unclassified_games:${unclassified.length}`);
  if (missing.length > 0) reasons.push(`missing_games:${missing.length}`);
  const blocking = ineligible.filter((g) => BLOCKING_INELIGIBLE.has(g.reason));
  if (blocking.length > 0) reasons.push(`classification_anomalies:${blocking.length}`);
  if (eligible.length === 0 && !providerCovers) reasons.push('empty_horizon_without_provider_evidence');

  return {
    ready: reasons.length === 0,
    horizon: h,
    coverage: providerCovers ? 'provider_verified' : 'db_only',
    reasons,
    warnings,
    eligible,
    unclassified,
    ineligible,
    missing,
  };
}

/** `rows === null` means the season-phase columns are absent: never ready. */
export function evaluateLoadedSeasonPhaseReadiness(input: {
  horizon: ReadinessHorizon;
  rows: readonly ReadinessGameRow[] | null;
  provider?: ProviderScheduleEvidence | null;
}): SeasonPhaseReadiness {
  if (input.rows == null) {
    return {
      ready: false,
      horizon: input.horizon,
      coverage: 'db_only',
      reasons: ['season_phase_columns_missing'],
      warnings: [],
      eligible: [],
      unclassified: [],
      ineligible: [],
      missing: [],
    };
  }
  return evaluateSeasonPhaseReadiness({ horizon: input.horizon, rows: input.rows, provider: input.provider });
}

/** Log/result-sized view: counts plus at most 50 ids per list. */
export type SeasonPhaseReadinessSummary = Pick<SeasonPhaseReadiness, 'ready' | 'horizon' | 'coverage' | 'reasons' | 'warnings'> & {
  counts: { eligible: number; unclassified: number; ineligible: number; missing: number };
  unclassified: string[];
  missing: string[];
  ineligible: SeasonPhaseReadiness['ineligible'];
};

export function summarizeSeasonPhaseReadiness(r: SeasonPhaseReadiness): SeasonPhaseReadinessSummary {
  return {
    ready: r.ready,
    horizon: r.horizon,
    coverage: r.coverage,
    reasons: r.reasons,
    warnings: r.warnings,
    counts: {
      eligible: r.eligible.length,
      unclassified: r.unclassified.length,
      ineligible: r.ineligible.length,
      missing: r.missing.length,
    },
    unclassified: r.unclassified.slice(0, 50),
    missing: r.missing.slice(0, 50).map((m) => m.gameId),
    ineligible: r.ineligible.slice(0, 50),
  };
}
