import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 6 auth billing landing', () => {
  const login = read('app/login/LoginClient.tsx');
  const signup = read('app/signup/SignupClient.tsx');
  const billing = read('app/billing/page.tsx');
  const hero = read('components/landing/LandingHero.tsx');
  const propsPreview = read('components/landing/LandingPropsTablePreview.tsx');
  const trending = read('components/landing/LandingTrendingPlayerStripPreview.tsx');
  const xray = read('components/landing/LandingParlayXrayPreview.tsx');
  const header = read('components/betting/Header.tsx');
  const previewBadge = read('components/preview/PreviewModeBridge.tsx');
  const logo = read('components/nba/TeamLogo.tsx');
  const docs = read('docs/typography.md');

  it('raises auth placeholders and support copy without shrinking the display title', () => {
    for (const source of [login, signup]) {
      expect(source).toContain('placeholder:text-[#4a6366]');
      expect(source).not.toContain('#8aa0a3');
      expect(source).toContain('type-body');
      expect(source).toContain('type-interactive');
      expect(source).toContain('text-3xl sm:text-4xl font-extrabold');
      expect(source).not.toContain('type-page-title');
      expect(source).not.toContain('text-[10px]');
      expect(source).not.toContain('text-[11px]');
    }
  });

  it('uses the page title and semantic roles on billing', () => {
    expect(billing).toContain('type-page-title');
    expect(billing).toContain('type-section-heading');
    expect(billing).toContain('type-body');
    expect(billing).toContain('type-card-data');
    expect(billing).toContain('type-interactive');
    expect(billing).toContain('FOUNDING_PRO_PRICE_CONCEPT');
    expect(billing).not.toContain('text-[10px]');
    expect(billing).not.toContain('#8aa0a3');
  });

  it('keeps the landing hero and aligns product previews with current roles', () => {
    expect(hero).toContain('text-[10px] sm:text-[11px]');
    expect(hero).toContain('Offseason Improvements In Progress');
    expect(propsPreview).toContain('type-table-data');
    expect(propsPreview).toContain('type-metadata');
    expect(propsPreview).toContain('type-badge');
    expect(propsPreview).not.toContain('text-[10px]');
    expect(propsPreview).not.toContain('#72869A');
    expect(trending).toContain('type-card-data');
    expect(trending).toContain('type-metadata');
    expect(trending).not.toContain('#72869A');
    expect(xray).toContain('text-4xl sm:text-5xl font-black');
    expect(xray).toContain('Upload your slip.');
    expect(xray).toContain('text-cc-secondary');
    expect(xray).not.toContain('#8aa0a3');
  });

  it('documents deferred routes and keeps approved compact exceptions', () => {
    expect(header).toContain('hidden md:block');
    expect(header).toContain('text-sm');
    expect(header).not.toContain('text-[#8aa0a3]');
    expect(previewBadge).toContain('text-[10px]');
    expect(logo).toContain("xs: 'text-[11px]'");
    expect(logo).not.toContain('text-[10px]');
    expect(docs).toContain('Phase 6 — COMPLETE');
    expect(docs).toContain('DEFERRED'.replace('DEFERRED', '/players/[playerId]'));
    expect(docs).toContain('Preview mode badge');
  });
});
