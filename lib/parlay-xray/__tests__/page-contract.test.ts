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
    expect(panel).toMatch(/TeamLogo/);
    expect(panel).toMatch(/matchupDisplayFromLeg/);
    expect(client).toMatch(/result_category: result/);
    expect(client).not.toMatch(/player_evidence|wager_evidence|odds_evidence/);
    const view = readFileSync(join(ROOT, 'components/parlay-xray/ParlayXrayView.tsx'), 'utf8');
    expect(view).toMatch(/Extract screenshot/);
    expect(view).not.toMatch(/42%–58%/);
    expect(view).not.toMatch(/Estimated Confidence/);
  });

  it('keeps the design fixture out of the production default state', () => {
    const initial = createInitialXrayState();
    expect(initial.designPreview).toBe(false);
    expect(selectAnalysisPresentation(initial).visible).toBe(false);
    expect(isXrayDesignPreviewEnabled('1', 'production')).toBe(false);
    expect(isXrayDesignPreviewEnabled('1', 'development')).toBe(true);
    expect(isXrayDesignPreviewEnabled('partial', 'development')).toBe(true);
    expect(isXrayDesignPreviewEnabled(null, 'development')).toBe(false);

    const client = readFileSync(join(ROOT, 'app/parlay-xray/ParlayXrayClient.tsx'), 'utf8');
    expect(client).toMatch(/isXrayDesignPreviewEnabled/);
    expect(client).toMatch(/NODE_ENV === 'production'/);
    expect(client).toMatch(/dev-fixture/);
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
