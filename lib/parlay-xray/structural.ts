import type { ExtractedParlayLeg, StructuralDependency } from './types';

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function knownText(field: { value: string | null; status: string }): string | null {
  if (field.status !== 'known' || !field.value) return null;
  const n = norm(field.value);
  return n || null;
}

/**
 * Logical overlaps visible on the slip itself.
 * This is not measured historical correlation and must not be labeled as such.
 */
export function detectStructuralDependencies(legs: ExtractedParlayLeg[]): StructuralDependency[] {
  const out: StructuralDependency[] = [];

  const byPlayer = new Map<string, string[]>();
  const byGame = new Map<string, string[]>();
  const byTeam = new Map<string, { legId: string; player: string }[]>();

  for (const leg of legs) {
    const player = knownText(leg.playerDisplayName);
    if (player) {
      const ids = byPlayer.get(player) ?? [];
      ids.push(leg.id);
      byPlayer.set(player, ids);
    }

    const team = knownText(leg.teamAbbr);
    const opp = knownText(leg.opponentAbbr);
    const game = team && opp ? [team, opp].sort().join('|') : knownText(leg.matchupLabel);
    if (game) {
      const ids = byGame.get(game) ?? [];
      ids.push(leg.id);
      byGame.set(game, ids);
    }

    if (team) {
      const rows = byTeam.get(team) ?? [];
      rows.push({ legId: leg.id, player: player ?? leg.id });
      byTeam.set(team, rows);
    }
  }

  for (const [player, ids] of byPlayer) {
    if (ids.length < 2) continue;
    out.push({
      kind: 'same_player',
      legIds: ids,
      label: `Multiple legs belong to ${player}.`,
    });
  }

  for (const [, ids] of byGame) {
    if (ids.length < 2) continue;
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    out.push({
      kind: 'same_game',
      legIds: unique,
      label: 'Multiple legs share the same game, so they can move together.',
    });
  }

  for (const [team, rows] of byTeam) {
    const uniquePlayers = new Set(rows.map((r) => r.player));
    if (uniquePlayers.size < 2) continue;
    out.push({
      kind: 'same_team_scoring',
      legIds: rows.map((r) => r.legId),
      label: `Multiple players on ${team.toUpperCase()} appear on this slip — they share a scoring environment.`,
    });
  }

  return out;
}

export function structuralFailureNotes(deps: StructuralDependency[]): Array<{ id: string; text: string }> {
  return deps.map((dep, i) => ({
    id: `structural-${dep.kind}-${i}`,
    text: dep.label,
  }));
}
