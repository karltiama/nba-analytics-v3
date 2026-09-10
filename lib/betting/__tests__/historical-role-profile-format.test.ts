import { describe, expect, it } from 'vitest';
import { emptyPlayerRoleProfile } from '@/lib/betting/historical-role-profile';
import {
  ROLE_MISSING,
  formatRolePercent,
  formatRolePerGame,
  formatRolePpp,
  hasCreationMetrics,
  shotProfileRows,
  visiblePlaytypes,
} from '@/lib/betting/historical-role-profile-format';

describe('Role Profile formatters', () => {
  it('formats poss_pct 0–1 fractions as percents', () => {
    expect(formatRolePercent(0.28)).toBe('28.0%');
    expect(formatRolePercent(0.36)).toBe('36.0%');
    expect(formatRolePercent(0)).toBe('0.0%');
  });

  it('formats PPP as a number, never a percent', () => {
    expect(formatRolePpp(1.163)).toBe('1.16');
    expect(formatRolePpp(0.96)).toBe('0.96');
    expect(formatRolePpp(1.163)).not.toContain('%');
  });

  it('formats null as em dash and never NaN', () => {
    expect(formatRolePercent(null)).toBe(ROLE_MISSING);
    expect(formatRolePpp(Number.NaN)).toBe(ROLE_MISSING);
    expect(formatRolePerGame(undefined)).toBe(ROLE_MISSING);
    expect(formatRolePercent(null)).not.toBe('0.0%');
  });

  it('omits unavailable playtypes instead of rendering 0%', () => {
    const profile = emptyPlayerRoleProfile('2024');
    profile.pnrBallHandlerPossPct = 0.42;
    profile.pnrBallHandlerPpp = 0.96;
    const rows = visiblePlaytypes(profile);
    expect(rows.map((r) => r.id)).toEqual(['pnrBallHandler']);
    expect(rows[0]?.frequency).toBe('42.0%');
    expect(rows[0]?.ppp).toBe('0.96');
    expect(rows.some((r) => r.frequency === '0.0%')).toBe(false);
  });

  it('maps provider zones to rim / paint / midrange / corner 3 / above break 3', () => {
    const profile = emptyPlayerRoleProfile('2025');
    profile.restrictedAreaFga = 4.0;
    profile.restrictedAreaFgPct = 0.62;
    profile.paintNonRaFga = 2.0;
    profile.paintNonRaFgPct = 0.45;
    profile.midrangeFga = 1.0;
    profile.midrangeFgPct = 0.4;
    profile.cornerThreeFga = 1.0;
    profile.cornerThreeFgPct = 0.39;
    profile.aboveBreakThreeFga = 2.0;
    profile.aboveBreakThreeFgPct = 0.35;
    const zones = shotProfileRows(profile);
    expect(zones.map((z) => z.label)).toEqual(['Rim', 'Paint', 'Midrange', 'Corner 3', 'Above Break 3']);
    expect(zones[0]?.fgPct).toBe('62.0%');
    expect(zones[0]?.sharePct).toBe(40);
    expect(hasCreationMetrics(profile)).toBe(false);
  });
});
