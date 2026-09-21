/**
 * Validate a TeamPreseasonPreviewDraft against its source packet.
 */

import type {
  PreseasonTeamPacket,
  TeamPreseasonPreviewDraft,
} from './types';

export type ValidationResult =
  | { ok: true; draft: TeamPreseasonPreviewDraft }
  | { ok: false; errors: string[]; draft: TeamPreseasonPreviewDraft };

const ENTITY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePreseasonPreviewDraft(
  draft: TeamPreseasonPreviewDraft,
  packet: PreseasonTeamPacket
): ValidationResult {
  const errors: string[] = [];
  const warnings = [...draft.review.warnings];

  if (draft.team.teamId !== packet.team.teamId) {
    errors.push('draft.team.teamId does not match packet');
  }
  if (draft.season !== packet.season) {
    errors.push('draft.season does not match packet');
  }

  if (draft.projectedRotation.status !== 'UNAVAILABLE') {
    errors.push('projectedRotation.status must be UNAVAILABLE in automated V1');
  }
  if (
    draft.projectedRotation.starters.length > 0 ||
    draft.projectedRotation.bench.length > 0
  ) {
    errors.push('projectedRotation must not invent starters/bench in V1');
  }

  if (!draft.sourceSummary) {
    errors.push('sourceSummary is required');
  } else {
    for (const key of [
      'factualFields',
      'derivedFields',
      'curatedFields',
      'unavailableFields',
    ] as const) {
      if (!Array.isArray(draft.sourceSummary[key])) {
        errors.push(`sourceSummary.${key} must be an array`);
      }
    }
  }

  if (draft.review.status !== 'NEEDS_REVIEW' && draft.review.status !== 'DRAFT') {
    // APPROVED only after human review — automated path must not emit APPROVED
    if (draft.review.status === 'APPROVED') {
      errors.push('automated drafts must not set review.status=APPROVED');
    }
  }

  const packetEntityIds = new Set([
    ...packet.currentRoster.map((p) => p.playerEntityId),
    ...packet.previousRoster.map((p) => p.playerEntityId),
    ...packet.additions.map((p) => p.playerEntityId),
    ...packet.departures.map((p) => p.playerEntityId),
    ...packet.returningPlayers.map((p) => p.playerEntityId),
  ]);

  const addIds = new Set(draft.rosterChanges.additions.map((p) => p.playerEntityId));
  const depIds = new Set(draft.rosterChanges.departures.map((p) => p.playerEntityId));
  for (const id of addIds) {
    if (depIds.has(id)) {
      errors.push(`player ${id} appears in both additions and departures`);
    }
  }

  const checkList = (
    label: string,
    rows: Array<{ playerEntityId: string; name: string }>
  ) => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!ENTITY_ID_RE.test(row.playerEntityId)) {
        errors.push(`${label}: invalid playerEntityId ${row.playerEntityId}`);
      }
      if (!packetEntityIds.has(row.playerEntityId)) {
        errors.push(
          `${label}: playerEntityId ${row.playerEntityId} (${row.name}) not in packet`
        );
      }
      if (seen.has(row.playerEntityId)) {
        errors.push(`${label}: duplicate playerEntityId ${row.playerEntityId}`);
      }
      seen.add(row.playerEntityId);
    }
  };

  checkList('additions', draft.rosterChanges.additions);
  checkList('departures', draft.rosterChanges.departures);
  checkList('returning', draft.rosterChanges.returning);
  checkList('playersToWatch', draft.playersToWatch);
  checkList('roleWatch', draft.roleWatch);

  if (draft.snapshot.allGamesMetricsExcludedFromPublicSnapshot !== true) {
    errors.push(
      'snapshot must set allGamesMetricsExcludedFromPublicSnapshot=true'
    );
  }

  // Public snapshot must not quietly use all-games record when RS unavailable
  if (!packet.previousSeasonRegular.available) {
    if (
      draft.snapshot.regularSeasonRecord != null ||
      draft.snapshot.regularSeasonOffensiveRating != null ||
      draft.snapshot.regularSeasonDefensiveRating != null ||
      draft.snapshot.regularSeasonPace != null
    ) {
      errors.push(
        'regular-season snapshot fields must be null when packet.previousSeasonRegular.available is false'
      );
    }
  } else {
    if (
      draft.snapshot.regularSeasonRecord !==
      packet.previousSeasonRegular.record
    ) {
      errors.push('snapshot.regularSeasonRecord must match packet regular season');
    }
  }

  // Never copy all-games record into public regularSeasonRecord
  if (
    packet.previousSeasonAllGames.available &&
    packet.previousSeasonAllGames.includesPostseason &&
    draft.snapshot.regularSeasonRecord != null &&
    draft.snapshot.regularSeasonRecord === packet.previousSeasonAllGames.record
  ) {
    errors.push(
      'snapshot.regularSeasonRecord must not equal all-games (postseason-contaminated) record'
    );
  }

  // Unsupported WOWY: packet has none — draft must not invent numeric WOWY
  if (
    packet.availableWowySummaries.length === 0 &&
    draft.wowyContext.length > 0
  ) {
    errors.push(
      'wowyContext must be empty when packet.availableWowySummaries is empty'
    );
  }

  // Soft check: prose should avoid arbitrary decimals not in packet
  const allowedNumbers = collectPacketNumbers(packet);
  const proseBlobs = [
    draft.headline,
    draft.dek,
    draft.outlook,
    ...draft.bigPicture,
    ...draft.playersToWatch.map((p) => p.watching),
    ...draft.roleWatch.map((r) => r.explanation),
    ...draft.keyQuestions.flatMap((q) => [q.headline, q.detail]),
  ].filter(Boolean) as string[];

  for (const text of proseBlobs) {
    const nums = text.match(/\d+\.\d+/g) ?? [];
    for (const n of nums) {
      const v = Number(n);
      if (!Number.isFinite(v)) continue;
      if (!allowedNumbers.has(roundKey(v))) {
        warnings.push(
          `Prose contains numeric ${n} not found in factual packet — prefer qualitative copy`
        );
      }
    }
  }

  const next: TeamPreseasonPreviewDraft = {
    ...draft,
    review: {
      status: draft.review.status === 'DRAFT' ? 'NEEDS_REVIEW' : draft.review.status,
      warnings: [...new Set(warnings)],
    },
  };

  if (errors.length > 0) {
    return { ok: false, errors, draft: next };
  }
  return { ok: true, draft: next };
}

function collectPacketNumbers(packet: PreseasonTeamPacket): Set<string> {
  const set = new Set<string>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    set.add(roundKey(n));
    set.add(roundKey(Math.round(n * 10) / 10));
    set.add(roundKey(Math.round(n * 100) / 100));
  };
  const rs = packet.previousSeasonRegular;
  if (rs.available) {
    add(rs.wins);
    add(rs.losses);
    add(rs.offensiveRating);
    add(rs.defensiveRating);
    add(rs.pace);
    add(rs.gamesPlayed);
  }
  for (const s of packet.playerSeasonStats) {
    add(s.mpg);
    add(s.ppg);
    add(s.usageAvg);
    add(s.gamesPlayed);
    add(s.usageTotalMinutes);
    add(s.recentCompetitive?.recentMpg);
    add(s.recentCompetitive?.baselineMpg);
  }
  return set;
}

function roundKey(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}
