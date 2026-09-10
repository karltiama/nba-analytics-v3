import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_RULES,
  evaluateDiscoverySignals,
  findContextCheckCandidates,
  MockContextCheckDiscovery,
} from '../discovery';

describe('evaluateDiscoverySignals', () => {
  it('flags recent-form divergence from the documented thresholds', () => {
    expect(
      evaluateDiscoverySignals({ l5HitRate: 0.8, seasonHitRate: 0.48 })
    ).toContain('recent_form_divergence');
    expect(
      evaluateDiscoverySignals({ l5HitRate: 0.79, seasonHitRate: 0.48 })
    ).not.toContain('recent_form_divergence');
    expect(
      evaluateDiscoverySignals({ l5HitRate: 0.9, seasonHitRate: 0.56 })
    ).not.toContain('recent_form_divergence');
  });

  it('flags line inflation when current line is at least 2 above recent average', () => {
    expect(
      evaluateDiscoverySignals({ currentLine: 27.5, recentAverageLine: 25.1 })
    ).toContain('line_inflation');
    expect(
      evaluateDiscoverySignals({ currentLine: 27.5, recentAverageLine: 26.0 })
    ).not.toContain('line_inflation');
    expect(DISCOVERY_RULES.lineInflation.minLineIncrease).toBe(2);
  });

  it('flags role change when minutes delta is at least 4', () => {
    expect(
      evaluateDiscoverySignals({ recentMinutes: 35.7, seasonMinutes: 29.2 })
    ).toContain('role_change');
    expect(
      evaluateDiscoverySignals({ recentMinutes: 32.0, seasonMinutes: 29.2 })
    ).not.toContain('role_change');
  });
});

describe('findContextCheckCandidates', () => {
  it('returns mock candidates without a database', async () => {
    const candidates = await findContextCheckCandidates(new MockContextCheckDiscovery());
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.data.player.name).toBeTruthy();
    expect(candidates.every((c) => typeof c.score === 'number')).toBe(true);
  });
});
