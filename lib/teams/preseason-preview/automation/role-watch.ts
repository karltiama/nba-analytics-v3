/**
 * Structured role-watch labels from deterministic evidence (editorial signals).
 * Never force a label — weak evidence → ROLE_TBD or omit.
 */

import type {
  PreseasonContextSignal,
  RoleWatchCandidate,
  RoleWatchLabel,
} from './types';

export function deriveRoleWatch(
  signals: PreseasonContextSignal[]
): RoleWatchCandidate[] {
  const byEntity = new Map<
    string,
    {
      playerEntityId: string;
      playerId: string | null;
      displayName: string;
      evidence: string[];
      labels: RoleWatchLabel[];
    }
  >();

  for (const s of signals) {
    if (s.type === 'VACATED_MINUTES') continue;
    let row = byEntity.get(s.playerEntityId);
    if (!row) {
      row = {
        playerEntityId: s.playerEntityId,
        playerId: s.playerId,
        displayName: s.displayName,
        evidence: [],
        labels: [],
      };
      byEntity.set(s.playerEntityId, row);
    }
    row.evidence.push(s.type);
    const label = labelForSignal(s.type);
    if (label && !row.labels.includes(label)) row.labels.push(label);
  }

  const out: RoleWatchCandidate[] = [];
  for (const row of byEntity.values()) {
    const label = pickLabel(row.labels, row.evidence);
    out.push({
      playerEntityId: row.playerEntityId,
      playerId: row.playerId,
      displayName: row.displayName,
      label,
      evidence: row.evidence,
    });
  }

  out.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
  );
  return out;
}

function labelForSignal(
  type: PreseasonContextSignal['type']
): RoleWatchLabel | null {
  switch (type) {
    case 'RETURNING_HIGH_MINUTE_PLAYER':
      return 'STABLE';
    case 'HIGH_USAGE_RETURNER':
      return 'STABLE';
    case 'NEW_HIGH_MINUTE_ADDITION':
      return 'COMPETITION';
    case 'RECENT_COMPETITIVE_MINUTES_INCREASE':
      return 'MINUTES_UP';
    default:
      return null;
  }
}

function pickLabel(
  labels: RoleWatchLabel[],
  evidence: string[]
): RoleWatchLabel {
  if (labels.length === 0 || evidence.length === 0) return 'ROLE_TBD';
  if (labels.includes('MINUTES_UP')) return 'MINUTES_UP';
  if (labels.includes('COMPETITION')) return 'COMPETITION';
  if (labels.includes('STABLE')) return 'STABLE';
  if (labels.includes('OPPORTUNITY')) return 'OPPORTUNITY';
  if (labels.includes('DEVELOPMENT')) return 'DEVELOPMENT';
  return 'ROLE_TBD';
}
