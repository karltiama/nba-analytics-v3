/**
 * First-run onboarding contract (STEP 14P.E9).
 * Questions exist only if they change destination or guidance density.
 * Readiness uses the E8 capability registry — never advertise kill-switched features.
 */

import { evaluateCapability } from '@/lib/entitlements/capabilities';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';

export const ONBOARDING_STORAGE_KEY = 'cc_onboarding_v2';
export const ONBOARDING_CHANGED_EVENT = 'cc-onboarding-changed';

/** Accounts created at/after this instant are new-user eligible for auto onboarding. */
export const ONBOARDING_NEW_USER_CUTOFF_ISO = '2026-09-16T00:00:00.000Z';

export const PRIMARY_INTENTS = [
  'research_props',
  'analyze_parlay',
  'research_players_games',
  'explore',
] as const;
export type PrimaryIntent = (typeof PRIMARY_INTENTS)[number];

export const GUIDANCE_LEVELS = ['getting_started', 'stats_researcher', 'advanced'] as const;
export type GuidanceLevel = (typeof GUIDANCE_LEVELS)[number];

export const GUIDANCE_MODES = ['guided', 'minimal'] as const;
export type GuidanceMode = (typeof GUIDANCE_MODES)[number];

export const COACHMARK_IDS = [
  'props-discover',
  'props-compare',
  'props-add-parlay',
  'workspace-intro',
  'workspace-analyze',
  'why-fail',
  'xray-flow',
] as const;
export type CoachmarkId = (typeof COACHMARK_IDS)[number];

export const CHECKLIST_ITEM_IDS = [
  'explore_prop',
  'compare_opened',
  'parlay_leg_added',
  'workspace_analyzed',
] as const;
export type ChecklistItemId = (typeof CHECKLIST_ITEM_IDS)[number];

export type OnboardingEligibility =
  | 'completed'
  | 'new_user'
  | 'guest_first_visit'
  | 'existing_user_prompt'
  | 'not_eligible';

export type OnboardingSurface = 'props' | 'workspace' | 'xray' | 'dashboard' | 'other';

export type LegacyPrimaryGoal = 'find_edges' | 'track_picks' | 'learn';
export type LegacyExperience = 'novice' | 'intermediate' | 'advanced';

const DESTINATIONS: Record<PrimaryIntent, string> = {
  research_props: '/betting/props-explorer',
  analyze_parlay: '/parlay-workspace',
  research_players_games: '/teams',
  explore: '/betting',
};

export const SKIP_DESTINATION = '/betting';

export function isPublicXrayExtractionReady(): boolean {
  const decision = evaluateCapability(
    { isPro: true, authenticated: true },
    'XRAY_EXTRACTION',
    { xrayExtractionEnabled: SCREENSHOT_EXTRACTION_AVAILABLE }
  );
  return decision.access === 'allow';
}

export function destinationForIntent(intent: PrimaryIntent | null | undefined): string {
  if (!intent) return SKIP_DESTINATION;
  if (intent === 'analyze_parlay' && isPublicXrayExtractionReady()) {
    return '/parlay-xray';
  }
  return DESTINATIONS[intent];
}

export function guidanceModeFor(level: GuidanceLevel | null | undefined): GuidanceMode {
  return level === 'advanced' ? 'minimal' : 'guided';
}

export function coachmarksForSurface(
  surface: OnboardingSurface,
  level: GuidanceLevel | null | undefined,
  previewFlag?: string | null
): CoachmarkId[] {
  if (surface === 'xray') {
    if (previewFlag !== 'replay') return [];
    if (guidanceModeFor(level) === 'minimal') return [];
    return ['xray-flow'];
  }
  if (guidanceModeFor(level) === 'minimal') return [];
  if (surface === 'props') {
    if (level === 'stats_researcher') return ['props-add-parlay'];
    return ['props-discover', 'props-compare', 'props-add-parlay'];
  }
  if (surface === 'workspace') {
    if (level === 'stats_researcher') return ['workspace-analyze', 'why-fail'];
    return ['workspace-intro', 'workspace-analyze', 'why-fail'];
  }
  return [];
}

export function surfaceForPath(pathname: string): OnboardingSurface {
  if (pathname.startsWith('/betting/props-explorer')) return 'props';
  if (pathname.startsWith('/parlay-workspace')) return 'workspace';
  if (pathname.startsWith('/parlay-xray')) return 'xray';
  if (pathname === '/betting' || pathname.startsWith('/betting?')) return 'dashboard';
  return 'other';
}

export function checklistItems(xrayReady = isPublicXrayExtractionReady()): {
  id: ChecklistItemId;
  href: string;
}[] {
  const items: { id: ChecklistItemId; href: string }[] = [
    { id: 'explore_prop', href: '/betting/props-explorer' },
    { id: 'compare_opened', href: '/betting/props-explorer' },
    { id: 'parlay_leg_added', href: '/betting/props-explorer' },
    { id: 'workspace_analyzed', href: '/parlay-workspace' },
  ];
  void xrayReady;
  return items;
}

export function mapIntentToLegacyGoal(intent: PrimaryIntent | null): LegacyPrimaryGoal | null {
  if (intent === 'research_props') return 'find_edges';
  if (intent === 'analyze_parlay') return 'track_picks';
  if (intent === 'research_players_games' || intent === 'explore') return 'learn';
  return null;
}

export function mapGuidanceToExperience(level: GuidanceLevel | null): LegacyExperience | null {
  if (level === 'getting_started') return 'novice';
  if (level === 'stats_researcher') return 'intermediate';
  if (level === 'advanced') return 'advanced';
  return null;
}

export function resolveEligibility(input: {
  onboardingCompletedAt?: string | null;
  createdAt?: string | null;
  localCompleted?: boolean;
  authenticated?: boolean;
}): OnboardingEligibility {
  if (input.onboardingCompletedAt || input.localCompleted) return 'completed';
  if (input.authenticated === false) {
    return input.localCompleted ? 'completed' : 'guest_first_visit';
  }
  if (!input.createdAt) return 'existing_user_prompt';
  const created = Date.parse(input.createdAt);
  const cutoff = Date.parse(ONBOARDING_NEW_USER_CUTOFF_ISO);
  if (Number.isFinite(created) && created >= cutoff) return 'new_user';
  return 'existing_user_prompt';
}

export function shouldAutoOpenOnboarding(
  eligibility: OnboardingEligibility,
  pathname: string,
  previewFlag?: string | null
): boolean {
  if (eligibility !== 'new_user' && eligibility !== 'guest_first_visit') return false;
  if (pathname === '/billing' || pathname.startsWith('/billing/')) return false;
  if (pathname.startsWith('/betting/profile')) return false;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  if (shouldSuppressProductPreviewAnalytics(previewFlag)) return false;
  return true;
}

export function nextCoachmark(input: {
  surface: OnboardingSurface;
  level: GuidanceLevel | null | undefined;
  dismissed: Iterable<CoachmarkId>;
  presentIds: Iterable<CoachmarkId>;
  replay?: boolean;
  previewFlag?: string | null;
}): CoachmarkId | null {
  const dismissed = new Set(input.dismissed);
  const present = new Set(input.presentIds);
  const sequence = coachmarksForSurface(input.surface, input.level, input.previewFlag);
  for (const id of sequence) {
    if (!present.has(id)) continue;
    if (dismissed.has(id)) continue;
    return id;
  }
  return null;
}
