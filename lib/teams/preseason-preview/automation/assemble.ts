/**
 * Assemble a draft from packet + signals (V1.1).
 * Public snapshot uses regular-season fields only.
 */

import { rankPlayerWatchCandidates } from './candidates';
import { deriveRoleWatch } from './role-watch';
import { derivePreseasonContextSignals } from './signals';
import type {
  EditorialTraceSection,
  PreseasonTeamPacket,
  TeamPreseasonPreviewDraft,
} from './types';

export type EditorialSections = {
  headline: string | null;
  dek: string | null;
  bigPicture: string[];
  playersToWatchCopy: Record<string, string | null>;
  roleWatchCopy: Record<string, string | null>;
  keyQuestions: Array<{ headline: string; detail: string }>;
  outlook: string | null;
  editorialTrace?: EditorialTraceSection[];
};

export const EMPTY_EDITORIAL: EditorialSections = {
  headline: null,
  dek: null,
  bigPicture: [],
  playersToWatchCopy: {},
  roleWatchCopy: {},
  keyQuestions: [],
  outlook: null,
  editorialTrace: [],
};

export function assemblePreseasonDraft(args: {
  packet: PreseasonTeamPacket;
  editorial?: EditorialSections;
}): TeamPreseasonPreviewDraft {
  const { packet } = args;
  const editorial = args.editorial ?? EMPTY_EDITORIAL;
  const signals = derivePreseasonContextSignals(packet);
  const candidates = rankPlayerWatchCandidates(packet, signals);
  const roleWatch = deriveRoleWatch(signals);
  const rs = packet.previousSeasonRegular;

  const factualSnapshotFields = rs.available
    ? [
        'snapshot.regularSeasonRecord',
        'snapshot.regularSeasonOffensiveRating',
        'snapshot.regularSeasonDefensiveRating',
        'snapshot.regularSeasonPace',
      ]
    : [];

  const unavailableSnapshot = rs.available
    ? []
    : [
        'snapshot.regularSeasonRecord',
        'snapshot.regularSeasonOffensiveRating',
        'snapshot.regularSeasonDefensiveRating',
        'snapshot.regularSeasonPace',
      ];

  return {
    version: 'team-preseason-preview-draft-v1.1',
    season: packet.season,
    generatedAt: new Date().toISOString(),
    team: packet.team,
    headline: editorial.headline,
    dek: editorial.dek,
    bigPicture: editorial.bigPicture,
    snapshot: {
      regularSeasonRecord: rs.available ? rs.record : null,
      regularSeasonOffensiveRating: rs.available ? rs.offensiveRating : null,
      regularSeasonDefensiveRating: rs.available ? rs.defensiveRating : null,
      regularSeasonPace: rs.available ? rs.pace : null,
      regularSeasonGamesPlayed: rs.available ? rs.gamesPlayed : null,
      playoffResult: null,
      offensiveRatingRank: null,
      defensiveRatingRank: null,
      paceRank: null,
      allGamesMetricsExcludedFromPublicSnapshot: true,
    },
    rosterChanges: {
      additions: packet.additions.map((p) => ({
        playerEntityId: p.playerEntityId,
        playerId: p.playerId,
        name: p.displayName,
        context: null,
      })),
      departures: packet.departures.map((p) => ({
        playerEntityId: p.playerEntityId,
        playerId: p.playerId,
        name: p.displayName,
        context: null,
      })),
      returning: packet.returningPlayers.map((p) => ({
        playerEntityId: p.playerEntityId,
        playerId: p.playerId,
        name: p.displayName,
        context: null,
      })),
    },
    playersToWatch: candidates.map((c) => ({
      playerEntityId: c.playerEntityId,
      playerId: c.playerId,
      name: c.displayName,
      reasons: c.reasons,
      watching: editorial.playersToWatchCopy[c.playerEntityId] ?? null,
    })),
    roleWatch: roleWatch.map((r) => ({
      playerEntityId: r.playerEntityId,
      playerId: r.playerId,
      name: r.displayName,
      label: r.label,
      evidence: r.evidence,
      explanation: editorial.roleWatchCopy[r.playerEntityId] ?? null,
    })),
    projectedRotation: {
      status: 'UNAVAILABLE',
      starters: [],
      bench: [],
    },
    keyQuestions: editorial.keyQuestions,
    wowyContext: [],
    preseasonSchedule: [],
    outlook: editorial.outlook,
    contextSignals: signals,
    editorialTrace: editorial.editorialTrace ?? [],
    sourceSummary: {
      factualFields: [
        'team',
        ...factualSnapshotFields,
        'rosterChanges.additions',
        'rosterChanges.departures',
        'rosterChanges.returning',
      ],
      derivedFields: [
        'contextSignals',
        'playersToWatch.reasons',
        'roleWatch.label',
        'roleWatch.evidence',
      ],
      curatedFields: [],
      unavailableFields: [
        ...unavailableSnapshot,
        'snapshot.playoffResult',
        'snapshot.offensiveRatingRank',
        'snapshot.defensiveRatingRank',
        'snapshot.paceRank',
        'projectedRotation',
        'preseasonSchedule',
        'wowyContext',
        'draftPicks',
        'previousSeasonAllGames (internal only — not public snapshot)',
      ],
    },
    review: {
      status: 'NEEDS_REVIEW',
      warnings: [...packet.warnings],
    },
  };
}
