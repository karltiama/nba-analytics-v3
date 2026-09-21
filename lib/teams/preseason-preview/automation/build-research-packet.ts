/**
 * Build V1.2 preseason research packet from factual layers.
 * No editorial prose. No invented WOWY / roles / projections.
 */

import { MEANINGFUL_MINUTE_MPG, HIGH_MINUTE_MPG, HIGH_USAGE_AVG } from './policy';
import {
  partitionRosterStatuses,
  type RosterStatusPlayer,
} from './roster-status';
import { derivePreseasonContextSignals } from './signals';
import type { PreseasonTeamPacket, PreseasonContextSignal } from './types';
import type {
  PreseasonResearchPacket,
  ResearchNotableStat,
  ResearchRoleShiftCandidate,
  ResearchWatchCandidate,
  ResearchWowyCandidate,
  TracedClaim,
} from './research-packet-types';

export const RESEARCH_PACKET_VERSION = 'preseason-research-packet-v1.2';

export function buildResearchPacketFromTeamPacket(args: {
  packet: PreseasonTeamPacket;
  rosterStatuses: RosterStatusPlayer[];
}): PreseasonResearchPacket {
  const { packet, rosterStatuses } = args;
  const parts = partitionRosterStatuses(rosterStatuses);

  // Signals must only vacate confirmed DEPARTED — rebuild packet lists first.
  const signalPacket: PreseasonTeamPacket = {
    ...packet,
    additions: parts.added.map((p) => ({
      playerEntityId: p.playerEntityId,
      displayName: p.displayName,
      playerId: p.playerId,
      position: p.position,
    })),
    departures: parts.departed.map((p) => ({
      playerEntityId: p.playerEntityId,
      displayName: p.displayName,
      playerId: p.playerId,
      position: p.position,
    })),
    returningPlayers: parts.returning.map((p) => ({
      playerEntityId: p.playerEntityId,
      displayName: p.displayName,
      playerId: p.playerId,
      position: p.position,
    })),
  };

  const signals = derivePreseasonContextSignals(signalPacket);
  const watch = buildWatchCandidates(signalPacket, signals, parts);
  const roleShifts = buildRoleShifts(signals, signalPacket);
  const wowy = buildWowyCandidates(parts, signals, packet);
  const questions = buildQuestions(parts, signals, packet);
  const notable = buildNotableStats(signalPacket, signals, parts);
  const unresolvedItems = buildUnresolvedItems(parts, packet, signals);

  const coverageNotes: string[] = [
    `Regular-season public snapshot scope: ${packet.previousSeasonRegular.metricsScope}`,
    `All-games internal snapshot includesPostseason=${packet.previousSeasonAllGames.includesPostseason}`,
    `Roster statuses: returning=${parts.returning.length} added=${parts.added.length} departed=${parts.departed.length} unresolved=${parts.unresolved.length}`,
    'Draft picks: unavailable (no draft table) — listed empty',
    'Previous seed / playoff result: unavailable — null',
  ];
  if (!packet.previousSeasonRegular.available) {
    coverageNotes.push(
      `Regular-season snapshot unavailable: ${packet.previousSeasonRegular.unavailableReason}`
    );
  }

  return {
    version: RESEARCH_PACKET_VERSION,
    generatedAt: new Date().toISOString(),
    season: packet.season,
    previousSeason: packet.previousSeason,
    team: packet.team,
    snapshot: {
      regularSeason: packet.previousSeasonRegular,
      allGamesInternal: packet.previousSeasonAllGames,
      previousSeed: null,
      previousPlayoffResult: null,
      coverageNotes,
    },
    roster: {
      additions: parts.added,
      departures: parts.departed,
      returningCore: selectReturningCore(parts.returning, packet),
      draftPicks: [],
      unresolved: parts.unresolved,
    },
    playersToWatchCandidates: watch,
    roleUsageShiftCandidates: roleShifts,
    wowyCandidates: wowy,
    researchQuestions: questions,
    notableStats: notable,
    unresolvedItems,
    contextSignals: signals,
    playerSeasonStats: packet.playerSeasonStats,
    provenanceSummary: [
      ...packet.provenanceSummary,
      {
        method: 'roster_status_v1.2',
        tables: ['analytics.team_roster_current'],
        season: packet.season,
        note: 'DEPARTED requires elsewhere current open roster evidence',
      },
      {
        method: 'human_roster_review_flags_v1.2.1',
        tables: ['analytics.player_game_logs', 'analytics.player_season_averages'],
        season: packet.previousSeason,
        note: 'requiresHumanRosterReview for high-impact confirmed DEPARTED/ADDED; status unchanged',
      },
    ],
    warnings: [
      ...packet.warnings,
      ...parts.unresolved.map(
        (u) =>
          `UNRESOLVED roster status: ${u.displayName} (${u.playerEntityId})`
      ),
      ...rosterStatuses
        .filter((r) => r.requiresHumanRosterReview)
        .map(
          (r) =>
            `HUMAN_ROSTER_REVIEW: ${r.displayName} [${r.status}] ${r.reviewReasons.join(',')}`
        ),
    ],
  };
}

function selectReturningCore(
  returning: RosterStatusPlayer[],
  packet: PreseasonTeamPacket
): RosterStatusPlayer[] {
  const byEntity = new Map(
    packet.playerSeasonStats.map((s) => [s.playerEntityId, s])
  );
  return returning
    .filter((p) => {
      const s = byEntity.get(p.playerEntityId);
      return (
        (s?.mpg != null && s.mpg >= MEANINGFUL_MINUTE_MPG) ||
        (s?.usageAvg != null && s.usageAvg >= HIGH_USAGE_AVG)
      );
    })
    .sort((a, b) => {
      const ma = byEntity.get(a.playerEntityId)?.mpg ?? 0;
      const mb = byEntity.get(b.playerEntityId)?.mpg ?? 0;
      return mb - ma;
    })
    .slice(0, 8);
}

function buildWatchCandidates(
  packet: PreseasonTeamPacket,
  signals: PreseasonContextSignal[],
  parts: ReturnType<typeof partitionRosterStatuses>
): ResearchWatchCandidate[] {
  const byEntity = new Map<string, ResearchWatchCandidate>();
  const stats = new Map(
    packet.playerSeasonStats.map((s) => [s.playerEntityId, s])
  );

  const ensure = (
    playerEntityId: string,
    displayName: string,
    playerId: string | null
  ) => {
    let row = byEntity.get(playerEntityId);
    if (!row) {
      const s = stats.get(playerEntityId);
      row = {
        playerEntityId,
        playerId,
        displayName,
        reasons: [],
        supportingSignalTypes: [],
        evidencePaths: [],
        relevantStats: {
          mpg: s?.mpg ?? null,
          ppg: s?.ppg ?? null,
          usageAvg: s?.usageAvg ?? null,
          recentMpg: s?.recentCompetitive?.recentMpg ?? null,
        },
      };
      byEntity.set(playerEntityId, row);
    }
    return row;
  };

  for (const s of signals) {
    if (s.type === 'VACATED_MINUTES') continue;
    const row = ensure(s.playerEntityId, s.displayName, s.playerId);
    if (!row.supportingSignalTypes.includes(s.type)) {
      row.supportingSignalTypes.push(s.type);
      row.reasons.push(s.type);
      row.evidencePaths.push(`contextSignals.${s.type}.${s.playerEntityId}`);
    }
  }

  // Vacated minutes → opportunity candidates among returning high-minute/usage
  const vacated = signals.filter((s) => s.type === 'VACATED_MINUTES');
  if (vacated.length > 0) {
    for (const p of parts.returning) {
      const st = stats.get(p.playerEntityId);
      if (
        !st ||
        ((st.mpg ?? 0) < MEANINGFUL_MINUTE_MPG &&
          (st.usageAvg ?? 0) < HIGH_USAGE_AVG)
      ) {
        continue;
      }
      const row = ensure(p.playerEntityId, p.displayName, p.playerId);
      if (!row.reasons.includes('VACATED_TEAMMATE_MINUTES')) {
        row.reasons.push('VACATED_TEAMMATE_MINUTES');
        row.evidencePaths.push(
          ...vacated.map(
            (v) => `roster.departures.${v.playerEntityId}.VACATED_MINUTES`
          )
        );
      }
    }
  }

  // Young / low mpg additions with any competitive tape → candidate only
  for (const p of parts.added) {
    const st = stats.get(p.playerEntityId);
    if (p.confidence === 'medium' && (st?.mpg == null || st.mpg < 10)) {
      const row = ensure(p.playerEntityId, p.displayName, p.playerId);
      if (!row.reasons.includes('NEW_ROSTER_ADDITION')) {
        row.reasons.push('NEW_ROSTER_ADDITION');
        row.evidencePaths.push(`roster.additions.${p.playerEntityId}`);
      }
    }
  }

  return [...byEntity.values()]
    .filter((c) => c.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length);
}

function buildRoleShifts(
  signals: PreseasonContextSignal[],
  packet: PreseasonTeamPacket
): ResearchRoleShiftCandidate[] {
  const out: ResearchRoleShiftCandidate[] = [];

  for (const s of signals) {
    let claim: TracedClaim;
    switch (s.type) {
      case 'VACATED_MINUTES':
        claim = {
          text: `${s.displayName} is a confirmed departure who averaged meaningful prior minutes — a candidate source of vacated minutes (not a projection of who absorbs them).`,
          evidence: [
            `contextSignals.VACATED_MINUTES.${s.playerEntityId}`,
            `roster.departures.${s.playerEntityId}`,
          ],
        };
        break;
      case 'HIGH_USAGE_RETURNER':
        claim = {
          text: `${s.displayName} is a returning player with prior-season high usage under mean_usage_pct_played_games_v1 — a candidate for continued high-usage monitoring.`,
          evidence: [
            `contextSignals.HIGH_USAGE_RETURNER.${s.playerEntityId}`,
            `playerSeasonStats.${s.playerEntityId}.usageAvg`,
          ],
        };
        break;
      case 'RECENT_COMPETITIVE_MINUTES_INCREASE':
        claim = {
          text: `${s.displayName} is a candidate whose recent competitive minutes exceeded prior baseline (window may include postseason).`,
          evidence: [
            `contextSignals.RECENT_COMPETITIVE_MINUTES_INCREASE.${s.playerEntityId}`,
            `playerSeasonStats.${s.playerEntityId}.recentCompetitive`,
          ],
        };
        break;
      case 'NEW_HIGH_MINUTE_ADDITION':
        claim = {
          text: `${s.displayName} is a confirmed addition with prior-season high minutes elsewhere — a candidate who could absorb rotation minutes.`,
          evidence: [
            `contextSignals.NEW_HIGH_MINUTE_ADDITION.${s.playerEntityId}`,
            `roster.additions.${s.playerEntityId}`,
          ],
        };
        break;
      case 'RETURNING_HIGH_MINUTE_PLAYER':
        claim = {
          text: `${s.displayName} is a returning high-minute player (prior MPG >= ${HIGH_MINUTE_MPG}).`,
          evidence: [
            `contextSignals.RETURNING_HIGH_MINUTE_PLAYER.${s.playerEntityId}`,
            `playerSeasonStats.${s.playerEntityId}.mpg`,
          ],
        };
        break;
      default:
        continue;
    }

    out.push({
      kind: s.type,
      playerEntityId: s.playerEntityId,
      playerId: s.playerId,
      displayName: s.displayName,
      claim,
      magnitude: s.magnitude,
    });
  }

  // Top usage returners by stats even if below HIGH_USAGE floor — informational
  const returningIds = new Set(packet.returningPlayers.map((p) => p.playerEntityId));
  const topUsage = [...packet.playerSeasonStats]
    .filter(
      (s) =>
        returningIds.has(s.playerEntityId) &&
        s.usageAvg != null &&
        s.usageAvg >= 0.2
    )
    .sort((a, b) => (b.usageAvg ?? 0) - (a.usageAvg ?? 0))
    .slice(0, 3);

  for (const s of topUsage) {
    if (out.some((r) => r.playerEntityId === s.playerEntityId && r.kind === 'HIGH_USAGE_RETURNER')) {
      continue;
    }
    out.push({
      kind: 'TOP_USAGE_RETURNER',
      playerEntityId: s.playerEntityId,
      playerId: s.playerId,
      displayName: s.displayName,
      claim: {
        text: `${s.displayName} ranks among returning prior-season usage leaders on this roster (descriptive ranking, not a role projection).`,
        evidence: [`playerSeasonStats.${s.playerEntityId}.usageAvg`],
      },
      magnitude: s.usageAvg,
    });
  }

  return out;
}

function buildWowyCandidates(
  parts: ReturnType<typeof partitionRosterStatuses>,
  signals: PreseasonContextSignal[],
  packet: PreseasonTeamPacket
): ResearchWowyCandidate[] {
  const out: ResearchWowyCandidate[] = [];

  // If packet has real WOWY summaries, surface them
  for (const w of packet.availableWowySummaries) {
    out.push({
      status: 'HAS_DATA',
      label: `Game-level with/without pair`,
      focalPlayerId: w.focalPlayerId,
      teammateId: w.teammateId,
      focalDisplayName: w.focalPlayerId,
      teammateDisplayName: w.teammateId,
      reason: 'Existing game-level WOWY summary available',
      evidencePaths: [
        `availableWowySummaries.${w.focalPlayerId}.${w.teammateId}`,
      ],
      sampleSize: w.sampleSize,
      supportTier: w.supportTier,
      metrics: w.metrics,
    });
  }

  // Otherwise propose review candidates from roster facts — no fabricated metrics
  const vacated = signals.filter((s) => s.type === 'VACATED_MINUTES');
  const stars = signals.filter(
    (s) =>
      s.type === 'HIGH_USAGE_RETURNER' ||
      s.type === 'RETURNING_HIGH_MINUTE_PLAYER'
  );

  for (const star of stars.slice(0, 3)) {
    for (const dep of vacated.slice(0, 3)) {
      out.push({
        status: 'CANDIDATE_FOR_REVIEW',
        label: `${star.displayName} with/without ${dep.displayName}`,
        focalPlayerId: star.playerId,
        teammateId: dep.playerId,
        focalDisplayName: star.displayName,
        teammateDisplayName: dep.displayName,
        reason:
          'Returning high-usage/minute player paired with a confirmed departed high-minute teammate — worth inspecting historically; no WOWY result computed here.',
        evidencePaths: [
          `contextSignals.${star.type}.${star.playerEntityId}`,
          `roster.departures.${dep.playerEntityId}`,
        ],
        sampleSize: null,
        supportTier: null,
        metrics: null,
      });
    }
  }

  // Returning core pairs
  const core = parts.returning.slice(0, 4);
  if (core.length >= 2) {
    out.push({
      status: 'CANDIDATE_FOR_REVIEW',
      label: `Returning core: ${core[0].displayName} + ${core[1].displayName}`,
      focalPlayerId: core[0].playerId,
      teammateId: core[1].playerId,
      focalDisplayName: core[0].displayName,
      teammateDisplayName: core[1].displayName,
      reason:
        'Two returning open-roster players — candidate pairing for descriptive WOWY review.',
      evidencePaths: [
        `roster.returning.${core[0].playerEntityId}`,
        `roster.returning.${core[1].playerEntityId}`,
      ],
      sampleSize: null,
      supportTier: null,
      metrics: null,
    });
  }

  return out;
}

function buildQuestions(
  parts: ReturnType<typeof partitionRosterStatuses>,
  signals: PreseasonContextSignal[],
  packet: PreseasonTeamPacket
): TracedClaim[] {
  const q: TracedClaim[] = [];
  const vacated = signals.filter((s) => s.type === 'VACATED_MINUTES');
  if (vacated.length > 0) {
    q.push({
      text: `Who absorbs minutes previously associated with ${vacated.map((v) => v.displayName).join(', ')}?`,
      evidence: vacated.map(
        (v) => `contextSignals.VACATED_MINUTES.${v.playerEntityId}`
      ),
    });
  }
  const highUsage = signals.find((s) => s.type === 'HIGH_USAGE_RETURNER');
  if (highUsage && vacated.length > 0) {
    q.push({
      text: `Does ${highUsage.displayName}'s usage profile change without ${vacated[0].displayName}?`,
      evidence: [
        `contextSignals.HIGH_USAGE_RETURNER.${highUsage.playerEntityId}`,
        `roster.departures.${vacated[0].playerEntityId}`,
      ],
    });
  }
  if (parts.added.length > 0) {
    q.push({
      text: `Which confirmed addition most changes spacing or rotation packing among ${parts.added
        .slice(0, 4)
        .map((a) => a.displayName)
        .join(', ')}?`,
      evidence: parts.added
        .slice(0, 4)
        .map((a) => `roster.additions.${a.playerEntityId}`),
    });
  }
  const recent = signals.filter(
    (s) => s.type === 'RECENT_COMPETITIVE_MINUTES_INCREASE'
  );
  if (recent.length > 0) {
    q.push({
      text: `Which recent-competitive minutes increases among ${recent
        .map((r) => r.displayName)
        .slice(0, 3)
        .join(', ')} hold once the regular season compresses roles?`,
      evidence: recent.map(
        (r) =>
          `contextSignals.RECENT_COMPETITIVE_MINUTES_INCREASE.${r.playerEntityId}`
      ),
    });
  }
  if (parts.unresolved.length > 0) {
    q.push({
      text: `What is the true roster status of unresolved names (${parts.unresolved
        .map((u) => u.displayName)
        .slice(0, 3)
        .join(', ')})?`,
      evidence: parts.unresolved.map(
        (u) => `roster.unresolved.${u.playerEntityId}`
      ),
    });
  }
  if (q.length < 3 && packet.previousSeasonRegular.available) {
    q.push({
      text: 'How does prior regular-season offensive/defensive profile constrain preseason expectations?',
      evidence: [
        'snapshot.regularSeason.offensiveRating',
        'snapshot.regularSeason.defensiveRating',
      ],
    });
  }
  return q.slice(0, 5);
}

function buildNotableStats(
  packet: PreseasonTeamPacket,
  signals: PreseasonContextSignal[],
  parts: ReturnType<typeof partitionRosterStatuses>
): ResearchNotableStat[] {
  const stats: ResearchNotableStat[] = [];
  const rs = packet.previousSeasonRegular;
  if (rs.available && rs.record) {
    stats.push({
      label: 'Previous regular-season record',
      value: `${rs.record} (${rs.gamesPlayed} GP)`,
      evidencePaths: ['snapshot.regularSeason.record'],
    });
  }
  if (rs.available && rs.offensiveRating != null) {
    stats.push({
      label: 'Previous regular-season ORTG',
      value: rs.offensiveRating.toFixed(1),
      evidencePaths: ['snapshot.regularSeason.offensiveRating'],
    });
  }
  if (rs.available && rs.defensiveRating != null) {
    stats.push({
      label: 'Previous regular-season DRTG',
      value: rs.defensiveRating.toFixed(1),
      evidencePaths: ['snapshot.regularSeason.defensiveRating'],
    });
  }

  const returningIds = new Set(parts.returning.map((p) => p.playerEntityId));
  const topMpg = [...packet.playerSeasonStats]
    .filter((s) => returningIds.has(s.playerEntityId) && s.mpg != null)
    .sort((a, b) => (b.mpg ?? 0) - (a.mpg ?? 0))
    .slice(0, 3);
  for (const s of topMpg) {
    stats.push({
      label: `Returning minutes leader — ${s.displayName}`,
      value: `${s.mpg!.toFixed(1)} MPG`,
      evidencePaths: [`playerSeasonStats.${s.playerEntityId}.mpg`],
    });
  }

  const topUsg = [...packet.playerSeasonStats]
    .filter((s) => returningIds.has(s.playerEntityId) && s.usageAvg != null)
    .sort((a, b) => (b.usageAvg ?? 0) - (a.usageAvg ?? 0))
    .slice(0, 2);
  for (const s of topUsg) {
    stats.push({
      label: `Returning usage leader — ${s.displayName}`,
      value: `${(s.usageAvg! * 100).toFixed(1)}% USG (mean played-game)`,
      evidencePaths: [`playerSeasonStats.${s.playerEntityId}.usageAvg`],
    });
  }

  for (const s of signals.filter((x) => x.type === 'VACATED_MINUTES')) {
    stats.push({
      label: `Vacated minutes — ${s.displayName}`,
      value: `${Number(s.evidence.previousSeasonMinutesPerGame).toFixed(1)} MPG (confirmed departure)`,
      evidencePaths: [
        `contextSignals.VACATED_MINUTES.${s.playerEntityId}`,
        `roster.departures.${s.playerEntityId}`,
      ],
    });
  }

  return stats.slice(0, 12);
}

function buildUnresolvedItems(
  parts: ReturnType<typeof partitionRosterStatuses>,
  packet: PreseasonTeamPacket,
  signals: PreseasonContextSignal[]
): TracedClaim[] {
  const items: TracedClaim[] = [];
  for (const u of parts.unresolved) {
    items.push({
      text: `Roster status unresolved for ${u.displayName}: absent from current open roster without elsewhere observation.`,
      evidence: u.evidence.map((e) => e.path),
    });
  }
  items.push({
    text: 'Draft picks unavailable — no draft table in analytics.',
    evidence: ['coverage.draftPicks.missing'],
  });
  items.push({
    text: 'Previous seed / playoff result unavailable — manual/curated only.',
    evidence: ['coverage.playoffResult.missing'],
  });
  if (packet.availableWowySummaries.length === 0) {
    items.push({
      text: 'No computed WOWY summaries attached; WOWY entries are CANDIDATE_FOR_REVIEW only.',
      evidence: ['availableWowySummaries.empty'],
    });
  }
  items.push({
    text: 'RECENT_COMPETITIVE_MINUTES_INCREASE windows may include postseason games by policy.',
    evidence: signals
      .filter((s) => s.type === 'RECENT_COMPETITIVE_MINUTES_INCREASE')
      .map(
        (s) =>
          `contextSignals.RECENT_COMPETITIVE_MINUTES_INCREASE.${s.playerEntityId}`
      ),
  });
  for (const w of packet.warnings) {
    items.push({
      text: w,
      evidence: ['packet.warnings'],
    });
  }
  return items;
}
