/**
 * Deterministic players-to-watch candidates (reasons only — no prose).
 */

import type {
  PlayerWatchCandidate,
  PlayerWatchReason,
  PreseasonContextSignal,
  PreseasonTeamPacket,
} from './types';

const REASON_FROM_SIGNAL: Partial<
  Record<PreseasonContextSignal['type'], PlayerWatchReason>
> = {
  HIGH_USAGE_RETURNER: 'HIGH_USAGE_RETURNER',
  RETURNING_HIGH_MINUTE_PLAYER: 'RETURNING_HIGH_MINUTE_PLAYER',
  NEW_HIGH_MINUTE_ADDITION: 'NEW_HIGH_MINUTE_ADDITION',
  RECENT_COMPETITIVE_MINUTES_INCREASE: 'RECENT_COMPETITIVE_MINUTES_INCREASE',
};

export function rankPlayerWatchCandidates(
  packet: PreseasonTeamPacket,
  signals: PreseasonContextSignal[]
): PlayerWatchCandidate[] {
  const byEntity = new Map<string, PlayerWatchCandidate>();

  const ensure = (s: PreseasonContextSignal): PlayerWatchCandidate => {
    let row = byEntity.get(s.playerEntityId);
    if (!row) {
      row = {
        playerEntityId: s.playerEntityId,
        playerId: s.playerId,
        displayName: s.displayName,
        reasons: [],
      };
      byEntity.set(s.playerEntityId, row);
    }
    return row;
  };

  for (const s of signals) {
    const reason = REASON_FROM_SIGNAL[s.type];
    if (!reason) continue;
    const row = ensure(s);
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
  }

  const vacatedCount = signals.filter((s) => s.type === 'VACATED_MINUTES').length;
  if (vacatedCount > 0) {
    for (const p of packet.returningPlayers) {
      const hasHighMinute = signals.some(
        (s) =>
          s.playerEntityId === p.playerEntityId &&
          (s.type === 'RETURNING_HIGH_MINUTE_PLAYER' ||
            s.type === 'HIGH_USAGE_RETURNER')
      );
      if (!hasHighMinute) continue;
      let row = byEntity.get(p.playerEntityId);
      if (!row) {
        row = {
          playerEntityId: p.playerEntityId,
          playerId: p.playerId,
          displayName: p.displayName,
          reasons: [],
        };
        byEntity.set(p.playerEntityId, row);
      }
      if (!row.reasons.includes('VACATED_TEAMMATE_MINUTES')) {
        row.reasons.push('VACATED_TEAMMATE_MINUTES');
      }
    }
  }

  const list = [...byEntity.values()];
  list.sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) {
      return b.reasons.length - a.reasons.length;
    }
    return a.displayName.localeCompare(b.displayName, 'en', {
      sensitivity: 'base',
    });
  });
  return list;
}
