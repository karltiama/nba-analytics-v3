/**
 * Conservative 2025–26 historical player-team stint reconstruction from PGL
 * appearance windows + final NBA.com roster open stints.
 *
 * observed_from / observed_to are observation / appearance evidence dates —
 * NOT signing or trade timestamps. Never invent transaction records.
 */

export type PglAppearance = {
  playerId: string;
  teamId: string;
  gameDate: string; // YYYY-MM-DD
  gameId?: string;
};

export type ContiguousTeamSegment = {
  playerId: string;
  teamId: string;
  observedFrom: string;
  observedTo: string;
  games: number;
  segmentIndex: number;
};

export type FinalRosterMembership = {
  playerId: string;
  teamId: string;
  stintId: number;
  observedFrom: string;
  source: string;
  sourcePlayerId: string | null;
  jersey: string | null;
  position: string | null;
};

export type PlannedHistoricalStint = {
  playerId: string;
  teamId: string;
  season: string;
  observedFrom: string;
  observedTo: string | null;
  source: 'inferred_pgl';
  membershipType: null;
  confidence:
    | 'pgl_inferred'
    | 'nba_plus_pgl'
    | 'nba_snapshot_confirmed';
};

export type ReconcileOpenFrom = {
  type: 'reconcile_open_from';
  stintId: number;
  playerId: string;
  teamId: string;
  observedFrom: string;
  /** Provenance note only — DB source column stays nba_stats unless caller changes it. */
  confidence: 'nba_plus_pgl' | 'nba_snapshot_confirmed';
};

export type SourceConflict = {
  playerId: string;
  finalTeamId: string;
  lastPglTeamId: string;
  lastPglDate: string;
  classification:
    | 'unresolved_source_conflict'
    | 'likely_roster_update_after_last_game'
    | 'likely_stale_pgl'
    | 'identity_uncertainty';
  note: string;
};

export type ManualReviewItem = {
  kind:
    | 'source_conflict'
    | 'impossible_stint_ordering'
    | 'overlapping_evidence'
    | 'identity_uncertainty'
    | 'unusual_team_transition';
  playerId: string;
  detail: string;
};

export type HistoricalReconstructPlan = {
  inferredStints: PlannedHistoricalStint[];
  reconcileOpens: ReconcileOpenFrom[];
  conflicts: SourceConflict[];
  manualQueue: ManualReviewItem[];
  skippedUnresolvedPlayerIds: string[];
  stats: {
    playersWithPgl: number;
    multiTeamPlayers: number;
    pglOnlyHistoricalPlayers: number;
    segmentsTotal: number;
    confidence: Record<string, number>;
  };
};

/**
 * Group a player's games into contiguous same-team appearance ranges.
 * Sort is by gameDate then gameId for determinism.
 */
export function contiguousTeamSegments(
  appearances: PglAppearance[]
): ContiguousTeamSegment[] {
  if (appearances.length === 0) return [];

  const sorted = [...appearances].sort((a, b) => {
    if (a.gameDate !== b.gameDate) return a.gameDate < b.gameDate ? -1 : 1;
    const ga = a.gameId ?? '';
    const gb = b.gameId ?? '';
    if (ga !== gb) return ga < gb ? -1 : 1;
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });

  const segments: ContiguousTeamSegment[] = [];
  let cur: ContiguousTeamSegment | null = null;

  for (const g of sorted) {
    if (cur && cur.teamId === g.teamId) {
      cur.observedTo = g.gameDate;
      cur.games += 1;
      continue;
    }
    if (cur) segments.push(cur);
    cur = {
      playerId: g.playerId,
      teamId: g.teamId,
      observedFrom: g.gameDate,
      observedTo: g.gameDate,
      games: 1,
      segmentIndex: segments.length,
    };
  }
  if (cur) segments.push(cur);
  return segments;
}

/** Group appearances by player_id then compute contiguous segments. */
export function segmentsByPlayer(
  appearances: PglAppearance[]
): Map<string, ContiguousTeamSegment[]> {
  const byPlayer = new Map<string, PglAppearance[]>();
  for (const a of appearances) {
    const list = byPlayer.get(a.playerId) ?? [];
    list.push(a);
    byPlayer.set(a.playerId, list);
  }
  const out = new Map<string, ContiguousTeamSegment[]>();
  for (const [playerId, list] of [...byPlayer.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    out.set(playerId, contiguousTeamSegments(list));
  }
  return out;
}

/**
 * Dates do not overlap when a.observedTo < b.observedFrom (closed intervals
 * on calendar days). Adjacent same-day handoff (to == next from) is allowed
 * only across different teams — same-team overlap is flagged.
 */
export function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/**
 * Plan historical inferred_pgl stints + open-stint reconciles.
 *
 * Precedence for sources (deterministic):
 * 1. nba_stats open final roster membership is authoritative for current team
 * 2. inferred_pgl fills closed historical appearance windows
 * 3. On agreement, reconcile observed_from on nba_stats to earliest PGL on that team
 * 4. On disagreement (final team ≠ last PGL team), fail-closed → conflict queue;
 *    still write closed PGL segments for non-final teams only
 *
 * Unresolved analytics player ids in `skipPlayerIds` are entirely skipped.
 */
export function planHistoricalReconstruction(args: {
  season: string;
  appearances: PglAppearance[];
  finalOpenByPlayer: Map<string, FinalRosterMembership>;
  skipPlayerIds?: Set<string>;
}): HistoricalReconstructPlan {
  const { season, appearances, finalOpenByPlayer } = args;
  const skip = args.skipPlayerIds ?? new Set<string>();

  const inferredStints: PlannedHistoricalStint[] = [];
  const reconcileOpens: ReconcileOpenFrom[] = [];
  const conflicts: SourceConflict[] = [];
  const manualQueue: ManualReviewItem[] = [];
  const skippedUnresolvedPlayerIds: string[] = [];
  const confidence: Record<string, number> = {};

  const bump = (k: string) => {
    confidence[k] = (confidence[k] ?? 0) + 1;
  };

  const byPlayer = segmentsByPlayer(appearances);
  let multiTeamPlayers = 0;
  let pglOnlyHistoricalPlayers = 0;
  let segmentsTotal = 0;

  for (const [playerId, segments] of byPlayer) {
    if (skip.has(playerId)) {
      skippedUnresolvedPlayerIds.push(playerId);
      bump('unresolved');
      continue;
    }
    if (segments.length === 0) continue;
    segmentsTotal += segments.length;

    const teams = new Set(segments.map((s) => s.teamId));
    if (teams.size > 1) multiTeamPlayers += 1;

    // Unusual: return to a prior team after leaving (A→B→A)
    const teamSeq = segments.map((s) => s.teamId);
    for (let i = 2; i < teamSeq.length; i++) {
      if (teamSeq.slice(0, i).includes(teamSeq[i]!)) {
        manualQueue.push({
          kind: 'unusual_team_transition',
          playerId,
          detail: `Team sequence ${teamSeq.join('→')} revisits ${teamSeq[i]}`,
        });
        break;
      }
    }

    // Ordering sanity: segments must be non-decreasing by observedFrom
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]!;
      const cur = segments[i]!;
      if (cur.observedFrom < prev.observedFrom) {
        manualQueue.push({
          kind: 'impossible_stint_ordering',
          playerId,
          detail: `Segment ${cur.segmentIndex} starts ${cur.observedFrom} before prior ${prev.observedFrom}`,
        });
      }
      if (
        prev.teamId === cur.teamId &&
        rangesOverlap(
          prev.observedFrom,
          prev.observedTo,
          cur.observedFrom,
          cur.observedTo
        )
      ) {
        manualQueue.push({
          kind: 'overlapping_evidence',
          playerId,
          detail: `Overlapping same-team segments on ${prev.teamId}`,
        });
      }
    }

    const final = finalOpenByPlayer.get(playerId);
    const lastSeg = segments[segments.length - 1]!;

    if (!final) {
      pglOnlyHistoricalPlayers += 1;
      for (const seg of segments) {
        inferredStints.push({
          playerId,
          teamId: seg.teamId,
          season,
          observedFrom: seg.observedFrom,
          observedTo: seg.observedTo,
          source: 'inferred_pgl',
          membershipType: null,
          confidence: 'pgl_inferred',
        });
        bump('pgl_inferred');
      }
      continue;
    }

    if (final.teamId !== lastSeg.teamId) {
      conflicts.push({
        playerId,
        finalTeamId: final.teamId,
        lastPglTeamId: lastSeg.teamId,
        lastPglDate: lastSeg.observedTo,
        classification: 'unresolved_source_conflict',
        note:
          'Final NBA.com roster team differs from most recent PGL team; keeping nba_stats open stint; writing closed PGL history for non-final teams only.',
      });
      manualQueue.push({
        kind: 'source_conflict',
        playerId,
        detail: `nba_stats=${final.teamId} vs last_pgl=${lastSeg.teamId} @ ${lastSeg.observedTo}`,
      });
      bump('conflict');

      for (const seg of segments) {
        if (seg.teamId === final.teamId) continue;
        inferredStints.push({
          playerId,
          teamId: seg.teamId,
          season,
          observedFrom: seg.observedFrom,
          observedTo: seg.observedTo,
          source: 'inferred_pgl',
          membershipType: null,
          confidence: 'pgl_inferred',
        });
        bump('pgl_inferred');
      }
      // Leave final open as nba_snapshot_confirmed (no reconcile from conflicting PGL)
      bump('nba_snapshot_confirmed');
      continue;
    }

    // Agreement: final team matches last PGL team
    const finalTeamFirstPgl = segments.find((s) => s.teamId === final.teamId);
    for (const seg of segments) {
      if (seg.teamId === final.teamId) continue;
      inferredStints.push({
        playerId,
        teamId: seg.teamId,
        season,
        observedFrom: seg.observedFrom,
        observedTo: seg.observedTo,
        source: 'inferred_pgl',
        membershipType: null,
        confidence: 'pgl_inferred',
      });
      bump('pgl_inferred');
    }

    if (finalTeamFirstPgl) {
      const newFrom =
        finalTeamFirstPgl.observedFrom < final.observedFrom
          ? finalTeamFirstPgl.observedFrom
          : final.observedFrom;
      reconcileOpens.push({
        type: 'reconcile_open_from',
        stintId: final.stintId,
        playerId,
        teamId: final.teamId,
        observedFrom: newFrom,
        confidence: 'nba_plus_pgl',
      });
      bump('nba_plus_pgl');
    } else {
      bump('nba_snapshot_confirmed');
    }
  }

  // Players on final roster with no PGL at all: still counted as nba_snapshot_confirmed
  for (const [playerId, final] of finalOpenByPlayer) {
    if (skip.has(playerId)) continue;
    if (byPlayer.has(playerId)) continue;
    bump('nba_snapshot_confirmed');
    void final;
  }

  skippedUnresolvedPlayerIds.sort();

  return {
    inferredStints,
    reconcileOpens,
    conflicts,
    manualQueue,
    skippedUnresolvedPlayerIds,
    stats: {
      playersWithPgl: byPlayer.size,
      multiTeamPlayers,
      pglOnlyHistoricalPlayers,
      segmentsTotal,
      confidence,
    },
  };
}

/**
 * Idempotent apply shape: replace all inferred_pgl for season with planned set.
 * Does not invent trade_date fields — callers must not add them.
 */
export function assertNoTransactionDateClaims(
  stints: PlannedHistoricalStint[]
): void {
  for (const s of stints) {
    const any = s as PlannedHistoricalStint & { tradeDate?: unknown };
    if ('tradeDate' in any && any.tradeDate != null) {
      throw new Error('PGL reconstruction must not claim trade_date');
    }
  }
}

/** Detect >1 open stint per player/season in a planned+existing union. */
export function findMultipleOpenPlayers(
  existingOpens: FinalRosterMembership[],
  inferred: PlannedHistoricalStint[]
): string[] {
  const open = new Map<string, number>();
  for (const e of existingOpens) {
    open.set(e.playerId, (open.get(e.playerId) ?? 0) + 1);
  }
  for (const s of inferred) {
    if (s.observedTo == null) {
      open.set(s.playerId, (open.get(s.playerId) ?? 0) + 1);
    }
  }
  return [...open.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();
}
