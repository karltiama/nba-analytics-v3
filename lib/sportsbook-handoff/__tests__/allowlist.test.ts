import { describe, expect, it } from 'vitest';
import {
  HANDOFF_ALLOWED_HOSTS,
  assertHandoffDestinationUrl,
  getVerifiedSportsbookHomeUrl,
} from '../allowlist';
import { HANDOFF_SPORTSBOOK_HOME_URLS, listHandoffProviders } from '../index';

describe('handoff allowlist', () => {
  it('includes approved Phase 3 hosts', () => {
    expect(HANDOFF_ALLOWED_HOSTS).toEqual([
      'sportsbook.draftkings.com',
      'sportsbook.fanduel.com',
      'sportsbook.caesars.com',
      'betfanatics.com',
      'www.betmgm.com',
    ]);
  });

  it('accepts every pinned homepage URL', () => {
    for (const provider of listHandoffProviders()) {
      const url = HANDOFF_SPORTSBOOK_HOME_URLS[provider];
      const result = assertHandoffDestinationUrl(url);
      expect(result.ok).toBe(true);
      expect(getVerifiedSportsbookHomeUrl(provider)).toMatch(/^https:\/\//);
    }
  });

  it('rejects http, foreign hosts, and dangerous schemes', () => {
    expect(assertHandoffDestinationUrl('http://sportsbook.draftkings.com/').ok).toBe(false);
    expect(assertHandoffDestinationUrl('https://evil.example.com/').ok).toBe(false);
    expect(assertHandoffDestinationUrl('javascript:alert(1)').ok).toBe(false);
    expect(assertHandoffDestinationUrl('data:text/html,hi').ok).toBe(false);
    expect(assertHandoffDestinationUrl('https://sportsbook.draftkings.com.evil.com/').ok).toBe(
      false
    );
  });
});
