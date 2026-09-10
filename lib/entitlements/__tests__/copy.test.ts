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
    for (const copy of Object.values(UPGRADE_COPY)) {
      const blob = `${copy.title} ${copy.detail}`;
      for (const banned of BANNED_PLAN_ALIASES) {
        expect(blob).not.toMatch(banned);
      }
    }
  });

  it('routes Upgrade through billing instead of Checkout', () => {
    expect(FOUNDING_PRO_UPGRADE_HREF).toBe('/billing');
  });
});
