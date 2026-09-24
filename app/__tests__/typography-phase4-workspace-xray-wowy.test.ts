import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 4 workspace xray wowy', () => {
  const workspace = read('components/parlay-workspace/ParlayWorkspaceView.tsx');
  const xray = read('components/parlay-xray/ParlayXrayView.tsx');
  const legs = read('components/parlay-xray/ExtractedLegsPanel.tsx');
  const results = read('components/parlay-xray/XrayResultsPanel.tsx');
  const analysis = read('components/parlay-xray/XrayAnalysisPanel.tsx');
  const summary = read('components/parlay-xray/XrayParlaySummary.tsx');
  const explorer = read('app/wowy/WowyExplorer.tsx');
  const wowy = read('app/wowy/WowyResults.tsx');
  const events = read('lib/product-analytics/track-event.ts');

  it('uses page and card roles on Workspace without 9px or 10px text', () => {
    expect(workspace).toContain('type-page-title');
    expect(workspace).toContain('Parlay Workspace');
    expect(workspace).toContain('type-card-data');
    expect(workspace).toContain('type-section-heading');
    expect(workspace).toContain('type-metadata');
    expect(workspace).toContain('type-interactive');
    expect(workspace).not.toContain('text-[9px]');
    expect(workspace).not.toContain('text-[10px]');
    expect(workspace).not.toContain('#8aa0a3');
    expect(workspace).not.toContain('#72869A');
  });

  it('keeps the X-Ray hero and raises extracted legs and statuses', () => {
    expect(xray).toContain('text-4xl sm:text-5xl font-black tracking-tight');
    expect(xray).toContain('Upload your slip.');
    expect(xray).not.toContain('type-page-title');
    expect(legs).toContain('type-card-data');
    expect(legs).toContain('type-metadata');
    expect(legs).toContain('type-badge');
    expect(results).toContain('type-badge');
    expect(analysis).toContain('type-badge');
    expect(summary).toContain('text-2xl font-black tracking-tight');
    for (const source of [xray, legs, analysis, summary]) {
      expect(source).not.toContain('text-[9px]');
      expect(source).not.toContain('text-[10px]');
      expect(source).not.toContain('#8aa0a3');
    }
    expect(results.match(/#8aa0a3/g)).toEqual(['#8aa0a3']);
    expect(results).toContain('aria-hidden');
  });

  it('keeps the WOWY display title and uses table and card roles on results', () => {
    expect(explorer).toContain('text-4xl sm:text-5xl font-black tracking-tight');
    expect(explorer).toContain('WOWY');
    expect(explorer).not.toContain('type-page-title');
    expect(wowy).toContain('text-2xl font-bold');
    expect(wowy).toContain('type-table-data');
    expect(wowy).toContain('type-card-data');
    expect(wowy).toContain('type-metadata');
    expect(wowy).not.toContain('text-[9px]');
    expect(wowy).not.toContain('text-[10px]');
    expect(wowy).not.toContain('text-[11px]');
    expect(explorer).not.toContain('#8aa0a3');
    expect(wowy).not.toContain('#8aa0a3');
  });

  it('leaves parlay analytics event names in place', () => {
    expect(events).toContain("PARLAY_XRAY_VIEWED: 'parlay_xray_viewed'");
    expect(events).toContain("PARLAY_XRAY_OPEN_WORKSPACE: 'parlay_xray_open_workspace'");
    expect(events).toContain("PARLAY_WORKSPACE_ANALYSIS_STARTED: 'parlay_workspace_analysis_started'");
  });
});
