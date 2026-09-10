/**
 * Season Role Profile display helpers (Step 12F).
 * Format only — never recompute playtype frequency, PPP, or zone shares from the box.
 * poss_pct and zone FG% are certified 0–1 fractions. PPP is not a percent.
 */

import type { HistoricalPlayerRoleProfile } from '@/lib/betting/historical-role-profile';

export const ROLE_MISSING = '—';

export const ROLE_METRIC_HELP = {
  possPct: 'Share of this player’s offensive possessions that were this play type during the season (provider qualification).',
  ppp: 'Points per possession on this play type during the season.',
  drives: 'Drives per game this season, as tracked by the provider.',
  drivePts: 'Points scored on drives per game this season.',
  passes: 'Passes made per game this season.',
  potentialAst: 'Potential assists per game this season.',
  zoneFga: 'Field-goal attempts per game from this zone this season.',
  zoneFg: 'Field-goal percentage from this zone this season.',
} as const;

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

/** 0.28 → 28.0%. Do not treat 0.28 as 0.28%. */
export function formatRolePercent(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ROLE_MISSING;
  return `${(n * 100).toFixed(1)}%`;
}

/** PPP 1.163 → 1.16. Never percent-format. */
export function formatRolePpp(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ROLE_MISSING;
  return n.toFixed(2);
}

export function formatRolePerGame(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n == null) return ROLE_MISSING;
  return n.toFixed(1);
}

export type RolePlaytypeRow = {
  id: 'isolation' | 'pnrBallHandler' | 'pnrRollMan';
  label: string;
  frequency: string;
  ppp: string;
  available: boolean;
};

export function visiblePlaytypes(profile: HistoricalPlayerRoleProfile | null | undefined): RolePlaytypeRow[] {
  if (!profile) return [];
  const rows: RolePlaytypeRow[] = [
    {
      id: 'isolation',
      label: 'Isolation',
      frequency: formatRolePercent(profile.isolationPossPct),
      ppp: formatRolePpp(profile.isolationPpp),
      available: profile.isolationPossPct != null || profile.isolationPpp != null,
    },
    {
      id: 'pnrBallHandler',
      label: 'PnR Ball Handler',
      frequency: formatRolePercent(profile.pnrBallHandlerPossPct),
      ppp: formatRolePpp(profile.pnrBallHandlerPpp),
      available: profile.pnrBallHandlerPossPct != null || profile.pnrBallHandlerPpp != null,
    },
    {
      id: 'pnrRollMan',
      label: 'PnR Roll Man',
      frequency: formatRolePercent(profile.pnrRollManPossPct),
      ppp: formatRolePpp(profile.pnrRollManPpp),
      available: profile.pnrRollManPossPct != null || profile.pnrRollManPpp != null,
    },
  ];
  return rows.filter((row) => row.available);
}

export type RoleZoneRow = {
  id: 'rim' | 'paint' | 'midrange' | 'corner3' | 'aboveBreak3';
  label: string;
  fga: string;
  fgPct: string;
  sharePct: number | null;
};

export function shotProfileRows(profile: HistoricalPlayerRoleProfile | null | undefined): RoleZoneRow[] {
  if (!profile) return [];
  const zones = [
    {
      id: 'rim' as const,
      label: 'Rim',
      fga: profile.restrictedAreaFga,
      fgPct: profile.restrictedAreaFgPct,
    },
    {
      id: 'paint' as const,
      label: 'Paint',
      fga: profile.paintNonRaFga,
      fgPct: profile.paintNonRaFgPct,
    },
    {
      id: 'midrange' as const,
      label: 'Midrange',
      fga: profile.midrangeFga,
      fgPct: profile.midrangeFgPct,
    },
    {
      id: 'corner3' as const,
      label: 'Corner 3',
      fga: profile.cornerThreeFga,
      fgPct: profile.cornerThreeFgPct,
    },
    {
      id: 'aboveBreak3' as const,
      label: 'Above Break 3',
      fga: profile.aboveBreakThreeFga,
      fgPct: profile.aboveBreakThreeFgPct,
    },
  ];
  const totalFga = zones.reduce((sum, zone) => sum + (finiteOrNull(zone.fga) ?? 0), 0);
  return zones.map((zone) => {
    const fga = finiteOrNull(zone.fga);
    return {
      id: zone.id,
      label: zone.label,
      fga: formatRolePerGame(zone.fga),
      fgPct: formatRolePercent(zone.fgPct),
      sharePct: fga != null && totalFga > 0 ? (fga / totalFga) * 100 : null,
    };
  });
}

export function hasCreationMetrics(profile: HistoricalPlayerRoleProfile | null | undefined): boolean {
  if (!profile) return false;
  return (
    profile.drivesPerGame != null ||
    profile.drivePointsPerGame != null ||
    profile.passesPerGame != null ||
    profile.potentialAssistsPerGame != null
  );
}

export function hasShotProfile(profile: HistoricalPlayerRoleProfile | null | undefined): boolean {
  if (!profile) return false;
  return shotProfileRows(profile).some((row) => row.fga !== ROLE_MISSING || row.fgPct !== ROLE_MISSING);
}
