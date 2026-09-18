/**
 * Official injury-report as-of T−60 reconstruction policy v1 (Phase 5A).
 *
 * Pure decision logic — no Postgres, no fetches, no WOWY, no PGL fill.
 *
 * Cutoff: tip − 60 minutes. Selection: max report_published_at where
 *   report_published_at < cutoff_at  AND  age ≤ 48h.
 * No rollback from NYS. No player status carry-forward. Missing ≠ Available.
 */

import { createHash } from 'node:crypto';

export const OFFICIAL_INJURY_ASOF_T60_VERSION = 'official-injury-asof-t60-v1' as const;

export const MAX_FRESHNESS_MINUTES = 48 * 60; // 2880

export type SnapshotPlayerRow = {
  player_name_raw: string;
  status_raw: string | null;
  reason_raw: string | null;
  page_number?: number | null;
  visual_row_index?: number | null;
};

export type SnapshotTeam = {
  team_id: string;
  abbr: string;
  side: 'away' | 'home';
  nys: boolean;
  structural_conflict?: boolean;
  players: SnapshotPlayerRow[];
  state_hint?: string;
};

export type GameSnapshot = {
  source_game_block_id: string;
  s3_key: string;
  source_sha256?: string | null;
  report_published_at: string;
  game_date: string;
  matchup: string;
  away_abbr: string;
  home_abbr: string;
  away_team_id: string;
  home_team_id: string;
  teams: Record<string, SnapshotTeam>;
  semantic_hash?: string;
};

export type GameLevelStatus =
  | 'VALID_PRE_T60_SNAPSHOT'
  | 'NO_PRE_T60_SNAPSHOT'
  | 'STALE_PRE_T60_SNAPSHOT'
  | 'NO_OFFICIAL_SOURCE_CONTENT'
  | 'SNAPSHOT_TIMESTAMP_CONFLICT'
  | 'OTHER_STRUCTURAL_FAILURE';

export type TeamStateKind =
  | 'SUBMITTED_WITH_PLAYER_ROWS'
  | 'NOT_YET_SUBMITTED'
  | 'TEAM_BLOCK_PRESENT_NO_PLAYER_ROWS'
  | 'TEAM_BLOCK_MISSING'
  | 'STRUCTURAL_CONFLICT'
  | 'SOURCE_ABSENT';

export type AgeBucket =
  | 'AGE_0_15_MIN'
  | 'AGE_16_30_MIN'
  | 'AGE_31_60_MIN'
  | 'AGE_61_120_MIN'
  | 'AGE_121_360_MIN'
  | 'AGE_361_720_MIN'
  | 'AGE_721_1440_MIN'
  | 'AGE_1441_2880_MIN'
  | 'STALE_GT_48H'
  | 'NO_PRE_CUTOFF_GAME_SNAPSHOT';

export type IdentityAttachment = {
  resolution_status: string;
  player_entity_id: string | null;
  serving_player_id: string | null;
  quarantine_reason: string | null;
};

function parseIso(ms: string): number {
  const t = Date.parse(ms);
  if (!Number.isFinite(t)) throw new Error(`Invalid ISO datetime: ${ms}`);
  return t;
}

export function cutoffFromTip(tipAtIso: string): string {
  const tip = parseIso(tipAtIso);
  return new Date(tip - 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function ageMinutes(cutoffAt: string, publishedAt: string): number {
  return (parseIso(cutoffAt) - parseIso(publishedAt)) / 60_000;
}

export function ageBucket(ageMin: number | null): AgeBucket {
  if (ageMin == null) return 'NO_PRE_CUTOFF_GAME_SNAPSHOT';
  if (ageMin > MAX_FRESHNESS_MINUTES) return 'STALE_GT_48H';
  if (ageMin <= 15) return 'AGE_0_15_MIN';
  if (ageMin <= 30) return 'AGE_16_30_MIN';
  if (ageMin <= 60) return 'AGE_31_60_MIN';
  if (ageMin <= 120) return 'AGE_61_120_MIN';
  if (ageMin <= 360) return 'AGE_121_360_MIN';
  if (ageMin <= 720) return 'AGE_361_720_MIN';
  if (ageMin <= 1440) return 'AGE_721_1440_MIN';
  return 'AGE_1441_2880_MIN';
}

export function computeSemanticHash(snapshot: {
  report_published_at: string;
  game_date: string;
  matchup: string;
  teams: Record<string, SnapshotTeam>;
}): string {
  const teams: Record<string, unknown> = {};
  for (const tid of Object.keys(snapshot.teams).sort()) {
    const t = snapshot.teams[tid]!;
    const players = [...t.players].sort((a, b) =>
      `${a.player_name_raw}|${a.status_raw}|${a.reason_raw}|${a.page_number}|${a.visual_row_index}`.localeCompare(
        `${b.player_name_raw}|${b.status_raw}|${b.reason_raw}|${b.page_number}|${b.visual_row_index}`
      )
    );
    teams[tid] = {
      abbr: t.abbr,
      nys: t.nys,
      structural_conflict: Boolean(t.structural_conflict),
      players,
    };
  }
  const payload = {
    report_published_at: snapshot.report_published_at,
    game_date: snapshot.game_date,
    matchup: snapshot.matchup,
    teams,
  };
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

export function classifyTeamState(team: SnapshotTeam | undefined, sourceAbsent: boolean): TeamStateKind {
  if (sourceAbsent) return 'SOURCE_ABSENT';
  if (!team) return 'TEAM_BLOCK_MISSING';
  if (team.structural_conflict || (team.nys && team.players.length > 0)) {
    return 'STRUCTURAL_CONFLICT';
  }
  if (team.nys) return 'NOT_YET_SUBMITTED';
  if (team.players.length > 0) return 'SUBMITTED_WITH_PLAYER_ROWS';
  // Parsed corpus does not currently represent empty-but-present team blocks distinctly
  return 'TEAM_BLOCK_MISSING';
}

export type SnapshotSelectionResult = {
  reconstructionVersion: typeof OFFICIAL_INJURY_ASOF_T60_VERSION;
  gameLevelStatus: GameLevelStatus;
  selected: GameSnapshot | null;
  selectedPublishedAt: string | null;
  snapshotAgeMinutes: number | null;
  ageBucket: AgeBucket;
  candidateCount: number;
  exactCutoffCount: number;
  futureCount: number;
  staleOnlyCount: number;
  duplicateTimestampConcordantGroups: number;
  duplicateTimestampConflict: boolean;
  notes: string[];
};

/**
 * Select the latest eligible game snapshot strictly before cutoff within 48h.
 * Same-timestamp groups: concordant hashes dedupe; conflicting hashes → conflict.
 */
export function selectAsOfT60Snapshot(args: {
  sourceContentAbsent: boolean;
  cutoffAt: string;
  snapshots: GameSnapshot[];
}): SnapshotSelectionResult {
  const notes: string[] = [];
  if (args.sourceContentAbsent) {
    return {
      reconstructionVersion: OFFICIAL_INJURY_ASOF_T60_VERSION,
      gameLevelStatus: 'NO_OFFICIAL_SOURCE_CONTENT',
      selected: null,
      selectedPublishedAt: null,
      snapshotAgeMinutes: null,
      ageBucket: 'NO_PRE_CUTOFF_GAME_SNAPSHOT',
      candidateCount: 0,
      exactCutoffCount: 0,
      futureCount: 0,
      staleOnlyCount: 0,
      duplicateTimestampConcordantGroups: 0,
      duplicateTimestampConflict: false,
      notes: ['SOURCE_GAME_TRULY_ABSENT_OR_NO_CERTIFIED_BLOCKS'],
    };
  }

  const cutoffMs = parseIso(args.cutoffAt);
  let exactCutoffCount = 0;
  let futureCount = 0;
  let staleOnlyCount = 0;

  const eligible: GameSnapshot[] = [];
  for (const s of args.snapshots) {
    const pub = parseIso(s.report_published_at);
    if (pub === cutoffMs) {
      exactCutoffCount += 1;
      continue;
    }
    if (pub > cutoffMs) {
      futureCount += 1;
      continue;
    }
    const age = (cutoffMs - pub) / 60_000;
    if (age > MAX_FRESHNESS_MINUTES) {
      staleOnlyCount += 1;
      continue;
    }
    eligible.push(s);
  }

  if (eligible.length === 0) {
    const status: GameLevelStatus =
      staleOnlyCount > 0 ? 'STALE_PRE_T60_SNAPSHOT' : 'NO_PRE_T60_SNAPSHOT';
    return {
      reconstructionVersion: OFFICIAL_INJURY_ASOF_T60_VERSION,
      gameLevelStatus: status,
      selected: null,
      selectedPublishedAt: null,
      snapshotAgeMinutes: null,
      ageBucket:
        status === 'STALE_PRE_T60_SNAPSHOT' ? 'STALE_GT_48H' : 'NO_PRE_CUTOFF_GAME_SNAPSHOT',
      candidateCount: 0,
      exactCutoffCount,
      futureCount,
      staleOnlyCount,
      duplicateTimestampConcordantGroups: 0,
      duplicateTimestampConflict: false,
      notes,
    };
  }

  // Group by timestamp
  const byTs = new Map<string, GameSnapshot[]>();
  for (const s of eligible) {
    const list = byTs.get(s.report_published_at) ?? [];
    list.push(s);
    byTs.set(s.report_published_at, list);
  }

  let concordantGroups = 0;
  const representatives: GameSnapshot[] = [];
  for (const [ts, group] of byTs) {
    const hashes = new Set(
      group.map((g) => g.semantic_hash ?? computeSemanticHash(g))
    );
    if (hashes.size > 1) {
      return {
        reconstructionVersion: OFFICIAL_INJURY_ASOF_T60_VERSION,
        gameLevelStatus: 'SNAPSHOT_TIMESTAMP_CONFLICT',
        selected: null,
        selectedPublishedAt: ts,
        snapshotAgeMinutes: ageMinutes(args.cutoffAt, ts),
        ageBucket: ageBucket(ageMinutes(args.cutoffAt, ts)),
        candidateCount: eligible.length,
        exactCutoffCount,
        futureCount,
        staleOnlyCount,
        duplicateTimestampConcordantGroups: concordantGroups,
        duplicateTimestampConflict: true,
        notes: ['DUPLICATE_TIMESTAMP_CONFLICT'],
      };
    }
    if (group.length > 1) concordantGroups += 1;
    // Deterministic pick: lowest source_game_block_id
    const picked = [...group].sort((a, b) =>
      a.source_game_block_id.localeCompare(b.source_game_block_id)
    )[0]!;
    representatives.push(picked);
  }

  representatives.sort((a, b) => {
    const d = parseIso(b.report_published_at) - parseIso(a.report_published_at);
    if (d !== 0) return d;
    return a.source_game_block_id.localeCompare(b.source_game_block_id);
  });
  const selected = representatives[0]!;
  const age = ageMinutes(args.cutoffAt, selected.report_published_at);

  // Guard: selected must be strictly before cutoff
  if (parseIso(selected.report_published_at) >= cutoffMs) {
    return {
      reconstructionVersion: OFFICIAL_INJURY_ASOF_T60_VERSION,
      gameLevelStatus: 'OTHER_STRUCTURAL_FAILURE',
      selected: null,
      selectedPublishedAt: null,
      snapshotAgeMinutes: null,
      ageBucket: 'NO_PRE_CUTOFF_GAME_SNAPSHOT',
      candidateCount: eligible.length,
      exactCutoffCount,
      futureCount,
      staleOnlyCount,
      duplicateTimestampConcordantGroups: concordantGroups,
      duplicateTimestampConflict: false,
      notes: ['SELECTED_NOT_STRICTLY_BEFORE_CUTOFF'],
    };
  }

  return {
    reconstructionVersion: OFFICIAL_INJURY_ASOF_T60_VERSION,
    gameLevelStatus: 'VALID_PRE_T60_SNAPSHOT',
    selected,
    selectedPublishedAt: selected.report_published_at,
    snapshotAgeMinutes: age,
    ageBucket: ageBucket(age),
    candidateCount: eligible.length,
    exactCutoffCount,
    futureCount,
    staleOnlyCount,
    duplicateTimestampConcordantGroups: concordantGroups,
    duplicateTimestampConflict: false,
    notes,
  };
}

export type SelectedPlayerState = {
  player_name_raw: string;
  status_raw: string | null;
  reason_raw: string | null;
  coarse:
    | 'EXPLICIT_OUT'
    | 'EXPLICIT_AVAILABLE'
    | 'EXPLICIT_NON_BINARY_STATUS'
    | 'UNKNOWN_STATUS';
  identity: IdentityAttachment | null;
  identity_bucket: 'RESOLVED_CANONICAL_ENTITY' | 'RESOLVED_ENTITY_NO_SERVING_PLAYER' | 'IDENTITY_QUARANTINED' | 'IDENTITY_MISSING';
};

export function coarseStatus(statusRaw: string | null): SelectedPlayerState['coarse'] {
  const s = (statusRaw || '').trim();
  if (s === 'Out') return 'EXPLICIT_OUT';
  if (s === 'Available') return 'EXPLICIT_AVAILABLE';
  if (s === 'Questionable' || s === 'Doubtful' || s === 'Probable') {
    return 'EXPLICIT_NON_BINARY_STATUS';
  }
  return 'UNKNOWN_STATUS';
}

export function attachIdentity(
  status: string | undefined
): SelectedPlayerState['identity_bucket'] {
  if (status === 'RESOLVED_CANONICAL_ENTITY') return 'RESOLVED_CANONICAL_ENTITY';
  if (status === 'RESOLVED_ENTITY_NO_SERVING_PLAYER') return 'RESOLVED_ENTITY_NO_SERVING_PLAYER';
  if (status) return 'IDENTITY_QUARANTINED';
  return 'IDENTITY_MISSING';
}

export type TeamReconstruction = {
  team_id: string;
  abbr: string;
  side: 'away' | 'home';
  team_state: TeamStateKind;
  players: SelectedPlayerState[];
  duplicate_entity_in_snapshot: boolean;
  duplicate_raw_name_conflict: boolean;
};

export function reconstructTeams(args: {
  sourceContentAbsent: boolean;
  selection: SnapshotSelectionResult;
  identityByKey: Map<string, IdentityAttachment>;
  gameId: string;
}): { away: TeamReconstruction; home: TeamReconstruction } {
  const selected = args.selection.selected;
  const build = (side: 'away' | 'home', teamId: string, abbr: string): TeamReconstruction => {
    if (args.sourceContentAbsent || args.selection.gameLevelStatus === 'NO_OFFICIAL_SOURCE_CONTENT') {
      return {
        team_id: teamId,
        abbr,
        side,
        team_state: 'SOURCE_ABSENT',
        players: [],
        duplicate_entity_in_snapshot: false,
        duplicate_raw_name_conflict: false,
      };
    }
    if (!selected) {
      return {
        team_id: teamId,
        abbr,
        side,
        team_state: 'TEAM_BLOCK_MISSING',
        players: [],
        duplicate_entity_in_snapshot: false,
        duplicate_raw_name_conflict: false,
      };
    }
    const team = selected.teams[teamId];
    const team_state = classifyTeamState(team, false);
    const players: SelectedPlayerState[] = [];
    if (team_state === 'SUBMITTED_WITH_PLAYER_ROWS' && team) {
      for (const p of team.players) {
        const key = `${args.gameId}|${teamId}|${p.player_name_raw}`;
        const id = args.identityByKey.get(key) ?? null;
        players.push({
          player_name_raw: p.player_name_raw,
          status_raw: p.status_raw,
          reason_raw: p.reason_raw,
          coarse: coarseStatus(p.status_raw),
          identity: id,
          identity_bucket: attachIdentity(id?.resolution_status),
        });
      }
    }
    // Duplicate entity detection
    const entityCounts = new Map<string, number>();
    const nameStatus = new Map<string, Set<string>>();
    for (const p of players) {
      const eid = p.identity?.player_entity_id;
      if (eid) entityCounts.set(eid, (entityCounts.get(eid) ?? 0) + 1);
      const st = p.status_raw ?? '';
      const set = nameStatus.get(p.player_name_raw) ?? new Set();
      set.add(st);
      nameStatus.set(p.player_name_raw, set);
    }
    const duplicate_entity_in_snapshot = [...entityCounts.values()].some((c) => c > 1);
    const duplicate_raw_name_conflict = [...nameStatus.values()].some((s) => s.size > 1);

    return {
      team_id: teamId,
      abbr,
      side,
      team_state,
      players,
      duplicate_entity_in_snapshot,
      duplicate_raw_name_conflict,
    };
  };

  // Prefer team ids from selected snapshot when present
  const awayId =
    selected?.away_team_id ??
    Object.values(selected?.teams ?? {}).find((t) => t.side === 'away')?.team_id ??
    '';
  const homeId =
    selected?.home_team_id ??
    Object.values(selected?.teams ?? {}).find((t) => t.side === 'home')?.team_id ??
    '';
  const awayAbbr = selected?.away_abbr ?? '';
  const homeAbbr = selected?.home_abbr ?? '';

  return {
    away: build('away', awayId, awayAbbr),
    home: build('home', homeId, homeAbbr),
  };
}

export type OfficialPlayerGameCutoffState =
  | 'EXPLICIT_OUT'
  | 'EXPLICIT_AVAILABLE'
  | 'EXPLICIT_QUESTIONABLE'
  | 'EXPLICIT_DOUBTFUL'
  | 'EXPLICIT_PROBABLE'
  | 'NO_EXPLICIT_PLAYER_STATUS_AT_CUTOFF'
  | 'TEAM_NOT_YET_SUBMITTED'
  | 'NO_VALID_PRE_T60_SNAPSHOT'
  | 'NO_OFFICIAL_SOURCE_CONTENT'
  | 'TEAM_BLOCK_MISSING'
  | 'STRUCTURAL_CONFLICT'
  | 'SNAPSHOT_TIMESTAMP_CONFLICT';

export function projectOfficialPlayerGameCutoff(args: {
  sourceContentAbsent: boolean;
  selection: SnapshotSelectionResult;
  teamState: TeamStateKind;
  playerNameRaw: string;
  selectedPlayers: SelectedPlayerState[];
}): {
  source_status_state: OfficialPlayerGameCutoffState;
  explicit_status_raw: string | null;
} {
  if (args.sourceContentAbsent) {
    return { source_status_state: 'NO_OFFICIAL_SOURCE_CONTENT', explicit_status_raw: null };
  }
  if (args.selection.gameLevelStatus === 'SNAPSHOT_TIMESTAMP_CONFLICT') {
    return { source_status_state: 'SNAPSHOT_TIMESTAMP_CONFLICT', explicit_status_raw: null };
  }
  if (
    args.selection.gameLevelStatus === 'NO_PRE_T60_SNAPSHOT' ||
    args.selection.gameLevelStatus === 'STALE_PRE_T60_SNAPSHOT'
  ) {
    return { source_status_state: 'NO_VALID_PRE_T60_SNAPSHOT', explicit_status_raw: null };
  }
  if (args.teamState === 'NOT_YET_SUBMITTED') {
    return { source_status_state: 'TEAM_NOT_YET_SUBMITTED', explicit_status_raw: null };
  }
  if (args.teamState === 'STRUCTURAL_CONFLICT') {
    return { source_status_state: 'STRUCTURAL_CONFLICT', explicit_status_raw: null };
  }
  if (args.teamState === 'TEAM_BLOCK_MISSING') {
    return { source_status_state: 'TEAM_BLOCK_MISSING', explicit_status_raw: null };
  }
  const hit = args.selectedPlayers.find((p) => p.player_name_raw === args.playerNameRaw);
  if (!hit) {
    return {
      source_status_state: 'NO_EXPLICIT_PLAYER_STATUS_AT_CUTOFF',
      explicit_status_raw: null,
    };
  }
  const s = (hit.status_raw || '').trim();
  if (s === 'Out') return { source_status_state: 'EXPLICIT_OUT', explicit_status_raw: s };
  if (s === 'Available')
    return { source_status_state: 'EXPLICIT_AVAILABLE', explicit_status_raw: s };
  if (s === 'Questionable')
    return { source_status_state: 'EXPLICIT_QUESTIONABLE', explicit_status_raw: s };
  if (s === 'Doubtful')
    return { source_status_state: 'EXPLICIT_DOUBTFUL', explicit_status_raw: s };
  if (s === 'Probable')
    return { source_status_state: 'EXPLICIT_PROBABLE', explicit_status_raw: s };
  return {
    source_status_state: 'NO_EXPLICIT_PLAYER_STATUS_AT_CUTOFF',
    explicit_status_raw: hit.status_raw,
  };
}
