import { describe, expect, it } from 'vitest';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import { evaluateCapability } from '@/lib/entitlements/capabilities';
import {
  checklistItems,
  coachmarksForSurface,
  destinationForIntent,
  guidanceModeFor,
  isPublicXrayExtractionReady,
  mapGuidanceToExperience,
  mapIntentToLegacyGoal,
  nextCoachmark,
  ONBOARDING_NEW_USER_CUTOFF_ISO,
  resolveEligibility,
  shouldAutoOpenOnboarding,
  surfaceForPath,
} from '../contract';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';
import { parseOnboardingState } from '../storage';
import { completeChecklistItem } from '../progress';
import { CHECKLIST_COPY, COACHMARK_COPY, INTENT_COPY } from '../copy';

describe('E9 onboarding contract', () => {
  it('routes primary intent to existing useful destinations', () => {
    expect(destinationForIntent('research_props')).toBe('/betting/props-explorer');
    expect(destinationForIntent('research_players_games')).toBe('/teams');
    expect(destinationForIntent('explore')).toBe('/betting');
    expect(destinationForIntent(null)).toBe('/betting');
  });

  it('does not route Analyze a parlay into disabled public XRay extraction', () => {
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    expect(isPublicXrayExtractionReady()).toBe(false);
    expect(destinationForIntent('analyze_parlay')).toBe('/parlay-workspace');
    expect(
      evaluateCapability({ isPro: true, authenticated: true }, 'XRAY_EXTRACTION', {
        xrayExtractionEnabled: false,
      }).reason
    ).toBe('KILL_SWITCH');
  });

  it('Pro cannot override XRay kill switch used for onboarding routing', () => {
    expect(
      evaluateCapability({ isPro: true, authenticated: true }, 'XRAY_EXTRACTION').access
    ).toBe('deny');
    expect(isPublicXrayExtractionReady()).toBe(false);
  });

  it('maps to existing user_settings CHECK values without new schema', () => {
    expect(mapIntentToLegacyGoal('research_props')).toBe('find_edges');
    expect(mapIntentToLegacyGoal('analyze_parlay')).toBe('track_picks');
    expect(mapIntentToLegacyGoal('research_players_games')).toBe('learn');
    expect(mapIntentToLegacyGoal('explore')).toBe('learn');
    expect(mapGuidanceToExperience('getting_started')).toBe('novice');
    expect(mapGuidanceToExperience('stats_researcher')).toBe('intermediate');
    expect(mapGuidanceToExperience('advanced')).toBe('advanced');
  });

  it('treats new accounts after the cutoff as auto-eligible and existing accounts as not blocked', () => {
    expect(
      resolveEligibility({
        authenticated: true,
        createdAt: '2026-09-16T12:00:00.000Z',
        onboardingCompletedAt: null,
      })
    ).toBe('new_user');
    expect(
      resolveEligibility({
        authenticated: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        onboardingCompletedAt: null,
      })
    ).toBe('existing_user_prompt');
    expect(
      resolveEligibility({
        authenticated: true,
        createdAt: '2026-09-20T00:00:00.000Z',
        onboardingCompletedAt: '2026-09-20T00:05:00.000Z',
      })
    ).toBe('completed');
    expect(resolveEligibility({ authenticated: false, localCompleted: false })).toBe(
      'guest_first_visit'
    );
    expect(resolveEligibility({ authenticated: false, localCompleted: true })).toBe('completed');
    expect(ONBOARDING_NEW_USER_CUTOFF_ISO).toBe('2026-09-16T00:00:00.000Z');
  });

  it('does not auto-open on billing and does not loop after completion', () => {
    expect(shouldAutoOpenOnboarding('new_user', '/betting')).toBe(true);
    expect(shouldAutoOpenOnboarding('new_user', '/billing')).toBe(false);
    expect(shouldAutoOpenOnboarding('completed', '/betting')).toBe(false);
    expect(shouldAutoOpenOnboarding('existing_user_prompt', '/betting')).toBe(false);
    expect(shouldAutoOpenOnboarding('guest_first_visit', '/betting/props-explorer')).toBe(true);
    expect(shouldAutoOpenOnboarding('new_user', '/admin/product-preview')).toBe(false);
    expect(shouldAutoOpenOnboarding('new_user', '/parlay-workspace', 'historical')).toBe(false);
    expect(shouldAutoOpenOnboarding('new_user', '/parlay-xray', 'replay')).toBe(false);
    expect(shouldAutoOpenOnboarding('new_user', '/betting/props-explorer', 'historical')).toBe(false);
  });

  it('reduces coachmarks for stats/advanced without gating features', () => {
    expect(guidanceModeFor('getting_started')).toBe('guided');
    expect(guidanceModeFor('advanced')).toBe('minimal');
    expect(coachmarksForSurface('props', 'getting_started')).toEqual([
      'props-discover',
      'props-compare',
      'props-add-parlay',
    ]);
    expect(coachmarksForSurface('props', 'stats_researcher')).toEqual(['props-add-parlay']);
    expect(coachmarksForSurface('props', 'advanced')).toEqual([]);
    expect(coachmarksForSurface('workspace', 'getting_started')).toEqual([
      'workspace-intro',
      'workspace-analyze',
      'why-fail',
    ]);
    expect(coachmarksForSurface('xray', 'getting_started')).toEqual([]);
    expect(coachmarksForSurface('xray', 'getting_started', 'replay')).toEqual(['xray-flow']);
    expect(coachmarksForSurface('xray', 'advanced', 'replay')).toEqual([]);
  });

  it('does not repeat dismissed coachmarks unless replay is set', () => {
    expect(
      nextCoachmark({
        surface: 'props',
        level: 'getting_started',
        dismissed: ['props-discover'],
        presentIds: ['props-discover', 'props-compare', 'props-add-parlay'],
      })
    ).toBe('props-compare');
    expect(
      nextCoachmark({
        surface: 'props',
        level: 'getting_started',
        dismissed: ['props-discover'],
        presentIds: ['props-discover', 'props-compare'],
        replay: true,
      })
    ).toBe('props-compare');
    expect(
      nextCoachmark({
        surface: 'workspace',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['workspace-intro'],
      })
    ).toBe('workspace-intro');
    expect(
      nextCoachmark({
        surface: 'workspace',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['why-fail'],
      })
    ).toBe('why-fail');
  });

  it('omits Try Parlay XRay from the checklist while extraction is disabled', () => {
    const items = checklistItems(false);
    expect(items.map((i) => i.id)).toEqual([
      'explore_prop',
      'compare_opened',
      'parlay_leg_added',
      'workspace_analyzed',
    ]);
    expect(items.some((i) => i.href === '/parlay-xray')).toBe(false);
    expect(JSON.stringify(CHECKLIST_COPY)).not.toMatch(/XRay/);
  });

  it('keeps copy serious and does not sell locks or live analysis', () => {
    const blob = `${JSON.stringify(INTENT_COPY)} ${JSON.stringify(COACHMARK_COPY)}`;
    expect(blob).not.toMatch(/lock|guaranteed|beat the books|win more|AI picks/i);
    expect(blob).toMatch(/3-Hour Pre-Tip → Decision Close/);
    expect(blob).not.toMatch(/Opening line is/);
  });

  it('identifies surfaces from existing routes', () => {
    expect(surfaceForPath('/betting/props-explorer')).toBe('props');
    expect(surfaceForPath('/parlay-workspace')).toBe('workspace');
    expect(surfaceForPath('/parlay-xray')).toBe('xray');
    expect(surfaceForPath('/betting')).toBe('dashboard');
  });
});

describe('onboarding local state', () => {
  it('parses only used fields and ignores wager-like extras', () => {
    const parsed = parseOnboardingState({
      version: 2,
      completed: true,
      primaryIntent: 'research_props',
      guidanceLevel: 'getting_started',
      player: 'LeBron',
      sportsbook: 'DraftKings',
      checklist: { explore_prop: true, unknown: true },
      dismissedCoachmarks: ['props-discover', 'nope'],
    });
    expect(parsed.completed).toBe(true);
    expect(parsed.primaryIntent).toBe('research_props');
    expect(parsed.checklist).toEqual({ explore_prop: true });
    expect(parsed.dismissedCoachmarks).toEqual(['props-discover']);
    expect(JSON.stringify(parsed)).not.toMatch(/LeBron|DraftKings/);
  });

  it('keeps primary intent when replay is requested', () => {
    const replayed = parseOnboardingState({
      completed: true,
      primaryIntent: 'analyze_parlay',
      guidanceLevel: 'advanced',
      replay: true,
      dismissedCoachmarks: [],
    });
    expect(replayed.primaryIntent).toBe('analyze_parlay');
    expect(replayed.guidanceLevel).toBe('advanced');
    expect(replayed.replay).toBe(true);
    expect(replayed.dismissedCoachmarks).toEqual([]);
  });
});

describe('preview harness isolation', () => {
  it('does not complete live checklist items on preview query routes', () => {
    expect(() => completeChecklistItem('workspace_analyzed', 'historical')).not.toThrow();
    expect(() => completeChecklistItem('explore_prop', 'replay')).not.toThrow();
    expect(shouldSuppressProductPreviewAnalytics('historical')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics('replay')).toBe(true);
    expect(shouldSuppressProductPreviewAnalytics(null)).toBe(false);
  });

  it('shows XRay flow coachmark only on certified replay preview', () => {
    expect(
      nextCoachmark({
        surface: 'xray',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['xray-flow'],
      })
    ).toBeNull();
    expect(
      nextCoachmark({
        surface: 'xray',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['xray-flow'],
        previewFlag: 'replay',
      })
    ).toBe('xray-flow');
  });

  it('lets preview harness show guided coachmarks without live onboarding completion', () => {
    expect(
      nextCoachmark({
        surface: 'props',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['props-discover', 'props-compare', 'props-add-parlay'],
        previewFlag: 'historical',
      })
    ).toBe('props-discover');
    expect(
      nextCoachmark({
        surface: 'workspace',
        level: 'getting_started',
        dismissed: [],
        presentIds: ['workspace-intro', 'workspace-analyze'],
        previewFlag: 'historical',
      })
    ).toBe('workspace-intro');
  });
});
