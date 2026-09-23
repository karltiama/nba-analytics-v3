import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutStartedProperties, upgradeClickedProperties } from '../conversion-events';
import {
  playerSearchResultOpenedProperties,
  playerSearchUsedProperties,
  searchResultCountBucket,
} from '../discovery-events';
import { landingCtaProperties } from '../landing-events';
import { closedXrayResultCategory } from '../parlay-xray-events';
import {
  closedPropMarket,
  propAddedToParlayProperties,
  propContextOpenedProperties,
  propOpenedProperties,
} from '../props-explorer-events';
import { sanitizeEventProperties, trackEvent } from '../track-event';
import {
  wowySeasonFilterProperties,
  wowyTeamStintFilterProperties,
  wowyTeammateFilterProperties,
} from '../wowy-events';

const ROOT = join(__dirname, '../../..');
const SENSITIVE = /email|player_name|player_id|query|filename|odds|line_value|sportsbook|stripe|session|@|password|leg/i;

afterEach(() => {
  const g = globalThis as typeof globalThis & { umami?: unknown };
  delete g.umami;
});

describe('closed X-Ray result categories', () => {
  it('keeps canonical codes and replaces everything else with UNKNOWN', () => {
    expect(closedXrayResultCategory('SUCCESS')).toBe('SUCCESS');
    expect(closedXrayResultCategory('UNREADABLE_IMAGE')).toBe('UNREADABLE_IMAGE');
    expect(closedXrayResultCategory('INTERNAL_ERROR')).toBe('INTERNAL_ERROR');
    expect(closedXrayResultCategory('provider exploded: slip text')).toBe('UNKNOWN');
    expect(closedXrayResultCategory('')).toBe('UNKNOWN');
    expect(closedXrayResultCategory(null)).toBe('UNKNOWN');
    expect(closedXrayResultCategory({ result: 'SUCCESS' })).toBe('UNKNOWN');
  });

  it('does not forward the raw result string from the X-Ray client', () => {
    const client = readFileSync(join(ROOT, 'app/parlay-xray/ParlayXrayClient.tsx'), 'utf8');
    expect(client).toMatch(/closedXrayResultCategory\(result\)/);
    expect(client).not.toMatch(/result_category: result\b/);
  });
});

describe('workspace preview suppression', () => {
  it('suppresses analysis_started on preview flags and leaves the preview client untracked', () => {
    const client = readFileSync(join(ROOT, 'app/parlay-workspace/ParlayWorkspaceClient.tsx'), 'utf8');
    expect(client).toMatch(/shouldSuppressProductPreviewAnalytics\(previewFlagFromWindow\(\)\)/);
    const call = client.indexOf('trackEvent(PARLAY_WORKSPACE_ANALYSIS_STARTED');
    const guard = client.lastIndexOf('shouldSuppressProductPreviewAnalytics', call);
    expect(call).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
    const preview = readFileSync(
      join(ROOT, 'app/parlay-workspace/ParlayWorkspacePreviewClient.tsx'),
      'utf8'
    );
    expect(preview).not.toMatch(/trackEvent/);
  });
});

describe('phase 1 payloads', () => {
  it('uses closed landing, search, prop, and upgrade payloads', () => {
    expect(landingCtaProperties('hero', 'explore_court_context')).toEqual({
      surface: 'landing',
      location: 'hero',
      action: 'explore_court_context',
    });
    expect(searchResultCountBucket(0)).toBe('0');
    expect(searchResultCountBucket(1)).toBe('1_5');
    expect(searchResultCountBucket(5)).toBe('1_5');
    expect(searchResultCountBucket(6)).toBe('6_plus');
    expect(searchResultCountBucket(Number.NaN)).toBe('0');
    expect(playerSearchUsedProperties('wowy', 2)).toEqual({
      surface: 'wowy',
      result_count_bucket: '1_5',
    });
    expect(playerSearchResultOpenedProperties('props_explorer')).toEqual({
      surface: 'props_explorer',
    });
    expect(closedPropMarket('points')).toBe('points');
    expect(closedPropMarket('NOT_A_MARKET')).toBe('other');
    expect(propOpenedProperties('rebounds').market).toBe('rebounds');
    expect(propAddedToParlayProperties(null).market).toBe('other');
    expect(propContextOpenedProperties('threes')).toEqual({
      surface: 'props_explorer',
      context_type: 'player_panel',
      market: 'threes',
    });
    expect(wowySeasonFilterProperties('2026')).toBeNull();
    expect(wowySeasonFilterProperties('2025')).toEqual({
      surface: 'wowy',
      filter: 'season',
      value: '2025',
    });
    expect(wowyTeamStintFilterProperties()).toEqual({ surface: 'wowy', filter: 'team_stint' });
    expect(wowyTeammateFilterProperties(true)).toEqual({
      surface: 'wowy',
      filter: 'teammate',
      value: 'selected',
    });
    expect(upgradeClickedProperties('slate_briefing')).toEqual({
      surface: 'slate_briefing',
      plan: 'founding_pro',
    });
    expect(checkoutStartedProperties()).toEqual({ surface: 'billing', plan: 'founding_pro' });
  });

  it('does not put sensitive fields in phase 1 payloads', () => {
    const payloads = [
      landingCtaProperties('header', 'sign_up'),
      playerSearchUsedProperties('props_explorer', 8),
      playerSearchResultOpenedProperties('wowy'),
      propOpenedProperties('points'),
      propAddedToParlayProperties('assists'),
      propContextOpenedProperties('blocks'),
      wowyTeamStintFilterProperties(),
      wowyTeammateFilterProperties(false),
      upgradeClickedProperties('game_briefing'),
      checkoutStartedProperties(),
    ];
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toMatch(SENSITIVE);
    }
    expect(
      sanitizeEventProperties({
        surface: 'props_explorer',
        market: 'points',
        query: undefined,
        nested: { player_name: 'hidden' },
      })
    ).toEqual({ surface: 'props_explorer', market: 'points' });
  });

  it('forwards a typed phase 1 event through trackEvent', () => {
    const track = vi.fn();
    (globalThis as typeof globalThis & { umami: { track: typeof track } }).umami = { track };
    trackEvent('landing_cta_clicked', landingCtaProperties('feature_section', 'open_wowy'));
    expect(track).toHaveBeenCalledWith('landing_cta_clicked', {
      surface: 'landing',
      location: 'feature_section',
      action: 'open_wowy',
    });
  });
});
