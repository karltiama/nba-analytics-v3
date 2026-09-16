import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';
import { PRIMARY_NAV } from '@/components/betting/primary-nav';
import { isXrayDesignPreviewEnabled } from '../copy';
import { createInitialXrayState, selectAnalysisPresentation } from '../session';
import { SCREENSHOT_EXTRACTION_AVAILABLE } from '../types';

const ROOT = join(__dirname, '../../../');

describe('Parlay XRay page contract', () => {
  it('is routed at /parlay-xray with Court Context shell and primary nav', () => {
    expect(shouldShowLayoutHeader('/parlay-xray')).toBe(true);
    expect(PRIMARY_NAV.some((n) => n.href === '/parlay-xray' && n.label === 'Parlay XRay')).toBe(true);
    const layout = readFileSync(join(ROOT, 'app/parlay-xray/layout.tsx'), 'utf8');
    expect(layout).toMatch(/BettingAppShell/);
  });

  it('redirects the parked bet-slip analyzer to Parlay XRay', () => {
    const src = readFileSync(join(ROOT, 'app/betting/bet-slip-analyzer/page.tsx'), 'utf8');
    expect(src).toMatch(/redirect\(['"]\/parlay-xray['"]\)/);
  });

  it('does not auto-call the leftover parser or Parlay Explorer', () => {
    expect(SCREENSHOT_EXTRACTION_AVAILABLE).toBe(false);
    const client = readFileSync(join(ROOT, 'app/parlay-xray/ParlayXrayClient.tsx'), 'utf8');
    expect(client).not.toMatch(/\/api\/betting\/bet-slip\/parse/);
    expect(client).not.toMatch(/\/parlay-explorer/);
    expect(client).toMatch(/\/api\/parlay-xray\/extract/);
    expect(client).toMatch(/\/api\/parlay-xray\/headshots/);
    expect(client).toMatch(/ATTACH_HEADSHOTS/);
    expect(client).toMatch(/EXTRACT_STARTED/);
    const panel = readFileSync(join(ROOT, 'components/parlay-xray/ExtractedLegsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/PlayerHeadshot/);
    expect(panel).toMatch(/MatchupLine/);
    const analysis = readFileSync(join(ROOT, 'components/parlay-xray/XrayAnalysisPanel.tsx'), 'utf8');
    expect(analysis).toMatch(/MatchupLine/);
    const matchup = readFileSync(join(ROOT, 'components/parlay-xray/MatchupLine.tsx'), 'utf8');
    expect(matchup).toMatch(/TeamLogo/);
    expect(matchup).toMatch(/matchupDisplayFromLeg/);
    expect(client).toMatch(/result_category: result/);
    expect(client).not.toMatch(/player_evidence|wager_evidence|odds_evidence/);
    const view = readFileSync(join(ROOT, 'components/parlay-xray/ParlayXrayView.tsx'), 'utf8');
    expect(view).toMatch(/Extract screenshot/);
    expect(view).not.toMatch(/42%–58%/);
    expect(view).not.toMatch(/Estimated Confidence/);
    expect(view).toMatch(/preview=analysis/);
    expect(view).toMatch(/Historical Replay/);
    expect(view).toMatch(/XrayResultsPanel/);
    const results = readFileSync(join(ROOT, 'components/parlay-xray/XrayResultsPanel.tsx'), 'utf8');
    expect(results).toMatch(/Why this could fail/);
    expect(results).toMatch(/3-Hour Pre-Tip/);
    expect(results).toMatch(/Decision Close/);
    expect(results).not.toMatch(/Opening/);
    expect(results).not.toMatch(/\bLive\b/);
    expect(results).not.toMatch(/strongest leg|weakest leg|win probability|take the Over/i);
    expect(results).not.toMatch(/HIGH CONFIDENCE|LOW CONFIDENCE|BEST BET/);
    expect(results).not.toMatch(/60%/);
    const parlaySummary = readFileSync(join(ROOT, 'components/parlay-xray/XrayParlaySummary.tsx'), 'utf8');
    expect(parlaySummary).toMatch(/Why this parlay could fail/);
    expect(parlaySummary).toMatch(/Shared context/);
    expect(parlaySummary).toMatch(/Data coverage/);
    expect(parlaySummary).toMatch(/Legs needing review/);
    expect(parlaySummary).toMatch(/not measured correlations/);
    expect(parlaySummary).not.toMatch(/positively correlated|win probability|strongest leg/i);
    const parlaySrc = readFileSync(join(ROOT, 'lib/parlay-xray/interpretation/parlay.ts'), 'utf8');
    expect(parlaySrc).not.toMatch(/correlat|openai|balldontlie|Date\.now\(/i);
    const interpret = readFileSync(join(ROOT, 'lib/parlay-xray/interpretation/interpret.ts'), 'utf8');
    expect(interpret).not.toMatch(/from '\.\.\/context\/assemble'|from '\.\.\/context\/sql'/);
    expect(interpret).not.toMatch(/openai|balldontlie/i);
  });

  it('keeps the design fixture out of the production default state', () => {
    const initial = createInitialXrayState();
    expect(initial.designPreview).toBe(false);
    expect(selectAnalysisPresentation(initial).visible).toBe(false);
    expect(isXrayDesignPreviewEnabled('1', 'production')).toBe(false);
    expect(isXrayDesignPreviewEnabled('1', 'development')).toBe(true);
    expect(isXrayDesignPreviewEnabled('partial', 'development')).toBe(true);
    expect(isXrayDesignPreviewEnabled('analysis', 'development')).toBe(true);
    expect(isXrayDesignPreviewEnabled('analysis', 'production')).toBe(false);
    expect(isXrayDesignPreviewEnabled(null, 'development')).toBe(false);

    const client = readFileSync(join(ROOT, 'app/parlay-xray/ParlayXrayClient.tsx'), 'utf8');
    expect(client).toMatch(/isXrayDesignPreviewEnabled/);
    expect(client).toMatch(/NODE_ENV === 'production'/);
    expect(client).toMatch(/dev-fixture/);
    expect(client).toMatch(/interpretation\/preview/);
    expect(client).toMatch(/previewFlag === 'analysis'/);
    expect(client).toMatch(/CONFIRM_LEGS/);
    expect(client).not.toMatch(/interpretXrayLeg\(/);
    expect(client).not.toMatch(/useSearchParams/);
    const index = readFileSync(join(ROOT, 'lib/parlay-xray/index.ts'), 'utf8');
    expect(index).not.toMatch(/dev-fixture/);
  });

  it('uses Court Context research language rather than win promises', () => {
    const view = readFileSync(join(ROOT, 'components/parlay-xray/ParlayXrayView.tsx'), 'utf8');
    expect(view).toMatch(/lg:grid-cols-12/);
    expect(view).toMatch(/lg:col-span-5/);
    expect(view).toMatch(/See beyond the bet slip/);
    expect(view).not.toMatch(/guaranteed/i);
    expect(view).not.toMatch(/beat the books/i);
    expect(view).not.toMatch(/instant winning/i);
  });
});
