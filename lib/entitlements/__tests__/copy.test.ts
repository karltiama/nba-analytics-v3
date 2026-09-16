import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOUNDING_PRO_PRICE_CONCEPT, UPGRADE_COPY } from '../types';
import { FOUNDING_PRO_UPGRADE_HREF } from '@/components/betting/betting-shell-paths';

const BANNED_PLAN_ALIASES = [/\bPremium\b/i, /\bPlus\b/i, /\bPro\+\b/i, /\bVIP\b/i];

describe('Founding Pro terminology', () => {
  it('keeps the public plan name Founding Pro', () => {
    expect(FOUNDING_PRO_PRICE_CONCEPT).toBe('$10/month');
    expect(UPGRADE_COPY.line_shopping_detail.title).toBe('Find the best book');
    expect(UPGRADE_COPY.line_shopping_detail.detail).toMatch(/Founding Pro/);
    expect(UPGRADE_COPY.market_movement.title).toBe(
      'See how this line moved from 3 hours before tip'
    );
    expect(UPGRADE_COPY.market_movement.detail).toMatch(/Founding Pro/);
    expect(UPGRADE_COPY.ai_briefing.title).toBe('AI research briefing — Founding Pro');
    expect(UPGRADE_COPY.advanced_history.title).toMatch(/not available yet/);
    expect(UPGRADE_COPY.alerts.title).toMatch(/not available yet/);
    expect(UPGRADE_COPY.advanced_history.detail).not.toMatch(/Unlock/);
    expect(UPGRADE_COPY.alerts.detail).not.toMatch(/Unlock/);
    for (const copy of Object.values(UPGRADE_COPY)) {
      const blob = `${copy.title} ${copy.detail}`;
      for (const banned of BANNED_PLAN_ALIASES) {
        expect(blob).not.toMatch(banned);
      }
    }
  });

  it('does not market WOWY or unshipped features as current Founding Pro exclusives', () => {
    expect(FOUNDING_PRO_PRICE_CONCEPT).toBe('$10/month');
    expect(UPGRADE_COPY.wowy.detail).not.toMatch(/Unlock game-level/);
    expect(UPGRADE_COPY.wowy.detail).toMatch(/already available/);
    const billing = readFileSync(join(process.cwd(), 'app/billing/page.tsx'), 'utf8');
    expect(billing).toMatch(/FOUNDING_PRO_PRICE_CONCEPT/);
    expect(billing).toMatch(/3-Hour Pre-Tip to Decision Close/);
    expect(billing).not.toMatch(/Stop checking multiple sportsbooks/);
    expect(billing).not.toMatch(/Start Winning/);
    expect(billing).toMatch(/not sell locks/);
    expect(billing).toMatch(/WOWY page/);
    expect(billing).toMatch(/Saved parlays, live current analysis, alerts/);
    expect(billing).toMatch(/screenshot extraction are not part of/);
    expect(billing).not.toMatch(/3\/day|10\/day|Global 100/);
    expect(billing).toMatch(/Why this parlay could fail/);
  });

  it('routes Upgrade through billing instead of Checkout', () => {
    expect(FOUNDING_PRO_UPGRADE_HREF).toBe('/billing');
  });
});
