/**
 * Pure helpers for roster observation → stint sync.
 *
 * Observation dates are NOT signing/trade timestamps.
 */

export type ObservedMembership = {
  playerId: string;
  teamId: string;
  sourcePlayerId: string | null;
  jersey: string | null;
  position: string | null;
  membershipType: string | null;
};

export type ExistingStint = {
  stintId: number;
  playerId: string;
  teamId: string;
  season: string;
  observedFrom: string; // YYYY-MM-DD
  observedTo: string | null;
  jersey: string | null;
  position: string | null;
  source: string;
  sourcePlayerId: string | null;
};

export type StintMutation =
  | {
      type: 'open';
      playerId: string;
      teamId: string;
      season: string;
      observedFrom: string;
      source: string;
      sourcePlayerId: string | null;
      jersey: string | null;
      position: string | null;
      membershipType: string | null;
    }
  | {
      type: 'touch';
      stintId: number;
      jersey: string | null;
      position: string | null;
      membershipType: string | null;
      sourcePlayerId: string | null;
    }
  | {
      type: 'close';
      stintId: number;
      observedTo: string;
    };

/**
 * Plan stint mutations for one analytics season given a full resolved snapshot.
 *
 * - Same team open stint → touch jersey/position (no duplicate open)
 * - Different team open stint → close old, open new
 * - No open stint → open
 * - Open stint for player absent from snapshot (same source) → close
 */
export function planStintSync(args: {
  season: string;
  observedOn: string; // YYYY-MM-DD
  source: string;
  observations: ObservedMembership[];
  existingOpenStints: ExistingStint[];
}): StintMutation[] {
  const { season, observedOn, source, observations, existingOpenStints } = args;
  const mutations: StintMutation[] = [];

  const openByPlayer = new Map<string, ExistingStint>();
  for (const s of existingOpenStints) {
    if (s.season !== season) continue;
    if (s.observedTo != null) continue;
    openByPlayer.set(s.playerId, s);
  }

  const seenPlayers = new Set<string>();

  for (const obs of observations) {
    if (seenPlayers.has(obs.playerId)) {
      // Deterministic: first observation wins; duplicates in same batch skipped.
      continue;
    }
    seenPlayers.add(obs.playerId);

    const open = openByPlayer.get(obs.playerId);
    if (!open) {
      mutations.push({
        type: 'open',
        playerId: obs.playerId,
        teamId: obs.teamId,
        season,
        observedFrom: observedOn,
        source,
        sourcePlayerId: obs.sourcePlayerId,
        jersey: obs.jersey,
        position: obs.position,
        membershipType: obs.membershipType,
      });
      continue;
    }

    if (open.teamId === obs.teamId) {
      mutations.push({
        type: 'touch',
        stintId: open.stintId,
        jersey: obs.jersey,
        position: obs.position,
        membershipType: obs.membershipType,
        sourcePlayerId: obs.sourcePlayerId,
      });
      continue;
    }

    // Team change observed: close prior open stint, open new.
    const closeOn =
      observedOn < open.observedFrom ? open.observedFrom : observedOn;
    mutations.push({
      type: 'close',
      stintId: open.stintId,
      observedTo: closeOn,
    });
    mutations.push({
      type: 'open',
      playerId: obs.playerId,
      teamId: obs.teamId,
      season,
      observedFrom: observedOn,
      source,
      sourcePlayerId: obs.sourcePlayerId,
      jersey: obs.jersey,
      position: obs.position,
      membershipType: obs.membershipType,
    });
  }

  // Close open stints for players missing from this snapshot (same season).
  for (const [playerId, open] of openByPlayer) {
    if (seenPlayers.has(playerId)) continue;
    // Only auto-close stints from the same source family to avoid clobbering
    // future manual / inferred_pgl stints prematurely.
    if (open.source !== source) continue;
    const closeOn =
      observedOn < open.observedFrom ? open.observedFrom : observedOn;
    mutations.push({
      type: 'close',
      stintId: open.stintId,
      observedTo: closeOn,
    });
  }

  return mutations;
}

/** Assert planned mutations never leave two opens for same player/season. */
export function assertSingleOpenPerPlayerSeason(
  mutations: StintMutation[],
  existingOpenStints: ExistingStint[],
  season: string
): void {
  const open = new Set<string>();
  for (const s of existingOpenStints) {
    if (s.season === season && s.observedTo == null) open.add(s.playerId);
  }
  for (const m of mutations) {
    if (m.type === 'close') {
      const stint = existingOpenStints.find((s) => s.stintId === m.stintId);
      if (stint) open.delete(stint.playerId);
    }
    if (m.type === 'open') {
      if (open.has(m.playerId)) {
        throw new Error(
          `Plan would create two open stints for player ${m.playerId} season ${season}`
        );
      }
      open.add(m.playerId);
    }
  }
}
