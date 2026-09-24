import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '@/lib/parlay-xray/types';
import { destinationForIntent, isPublicXrayExtractionReady } from '../contract';

const ROOT = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('E9 first-run page contract', () => {
  const modal = read('components/betting/OnboardingModal.tsx');
  const gate = read('components/betting/OnboardingGate.tsx');
  const route = read('app/api/user/onboarding/route.ts');
  const header = read('components/betting/Header.tsx');
  const shell = read('components/betting/BettingAppShell.tsx');
  const checklist = read('components/onboarding/GettingStartedChecklist.tsx');
  const dashboard = read('app/dashboard/page.tsx');
  const explorer = read('app/betting/props-explorer/page.tsx');
  const workspace = read('components/parlay-workspace/ParlayWorkspaceView.tsx');
  const summary = read('components/parlay-xray/XrayParlaySummary.tsx');

  it('is a short skippable flow with destination questions only', () => {
    expect(modal).toMatch(/Skip for now/);
    expect(modal).toMatch(/What are you here to do\?/);
    expect(modal).toMatch(/How do you usually research NBA props\?/);
    expect(modal).toMatch(/ONBOARDING_WELCOME\.title/);
    expect(read('lib/onboarding/copy.ts')).toMatch(/Welcome to Court Context/);
    expect(modal).not.toMatch(/Preferred sportsbook|odds format|Paper trading|bankroll|favorite team|Find edges/i);
    expect(modal).not.toMatch(/lock|guaranteed|Start Winning|AI picks/i);
    expect(gate).toMatch(/destinationForIntent/);
    expect(gate).toMatch(/shouldAutoOpenOnboarding/);
    expect(gate).toMatch(/existing_user_prompt/);
    expect(gate).not.toMatch(/signin_required/);
  });

  it('reuses existing onboarding columns and does not introduce schema', () => {
    expect(route).toMatch(/onboarding_completed_at/);
    expect(route).toMatch(/mapIntentToLegacyGoal/);
    expect(route).toMatch(/mapGuidanceToExperience/);
    expect(route).toMatch(/skipped/);
    expect(route).not.toMatch(/ALTER TABLE|CREATE TABLE/);
    expect(read('lib/onboarding/contract.ts')).toMatch(/find_edges/);
  });

  it('keeps public XRay extraction disabled and omits it from first-run actions', () => {
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    expect(isPublicXrayExtractionReady()).toBe(false);
    expect(destinationForIntent('analyze_parlay')).toBe('/parlay-workspace');
    expect(checklist).not.toMatch(/parlay-xray|Try Parlay XRay/);
    expect(dashboard).not.toMatch(/Analyze a Parlay/);
    expect(dashboard).toMatch(/href="\/parlay-workspace"/);
    expect(dashboard).not.toMatch(/href="\/parlay-xray"/);
    expect(workspace).toMatch(/isPublicXrayExtractionReady/);
    expect(workspace).toMatch(/Import with XRay/);
    expect(workspace).toMatch(/Screenshot import is not available yet/);
  });

  it('places contextual coachmarks and replayable help', () => {
    expect(explorer).toMatch(/data-coachmark="props-discover"/);
    expect(explorer).toMatch(/data-coachmark="props-compare"/);
    expect(explorer).toMatch(/data-coachmark="props-add-parlay"/);
    expect(workspace).toMatch(/data-coachmark="workspace-intro"/);
    expect(workspace).toMatch(/data-coachmark="workspace-analyze"/);
    expect(summary).toMatch(/data-coachmark="why-fail"/);
    expect(read('components/parlay-xray/ParlayXrayView.tsx')).toMatch(/data-coachmark="xray-flow"/);
    expect(header).toMatch(/How Court Context works/);
    expect(header).toMatch(/ProductTourDialog/);
    expect(shell).toMatch(/GuidanceHost/);
    expect(read('components/admin/product-preview/ProductPreviewHub.tsx')).toMatch(
      /Onboarding guidance QA/
    );
    expect(read('lib/onboarding/storage.ts')).toMatch(/dismissedCoachmarks: \[\]/);
    expect(read('lib/onboarding/storage.ts')).toMatch(/primaryIntent/);
    expect(read('lib/onboarding/storage.ts')).toMatch(/shouldSuppressProductPreviewAnalytics/);
    expect(read('lib/onboarding/progress.ts')).toMatch(/shouldSuppressProductPreviewAnalytics/);
    expect(read('components/onboarding/ProductTourDialog.tsx')).toMatch(
      /shouldSuppressProductPreviewAnalytics/
    );
    expect(read('components/onboarding/GuidanceHost.tsx')).toMatch(/previewDismissed/);
    expect(read('components/onboarding/GuidanceHost.tsx')).toMatch(/level: 'getting_started'/);
  });
});
