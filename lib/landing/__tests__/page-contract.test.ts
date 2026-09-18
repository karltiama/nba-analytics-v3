import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('landing honesty contract (E10)', () => {
  it('uses Court Context brand and does not sell winning picks', () => {
    const page = read('app/page.tsx');
    const layout = read('app/layout.tsx');
    const hero = read('components/landing/LandingHero.tsx');
    expect(layout).toMatch(/title: "Court Context"/);
    expect(page).toMatch(/Court Context/);
    expect(page).not.toMatch(/NBAEdge/);
    expect(hero).toMatch(/Explore Court Context/);
    expect(hero).not.toMatch(/Start Winning/);
    const auth = read('components/auth/AuthSplitLayout.tsx');
    expect(hero).not.toMatch(/injuries/);
    expect(auth).not.toMatch(/injuries/);
    expect(auth).toMatch(/More than the trend/);
  });

  it('labels sample landing cards and does not deep-link demo game ids', () => {
    const featured = read('components/landing/FeaturedGames.tsx');
    const cards = read('components/betting/GameCard.tsx');
    expect(featured).toMatch(/samplePreview/);
    expect(featured).toMatch(/Illustration only/);
    expect(featured).not.toMatch(/View Full Terminal/);
    expect(featured).not.toMatch(/live odds and analysis/);
    expect(cards).toMatch(/samplePreview \? '\/betting'/);
  });

  it('frames teammate impact as historical context, not a prediction or tip', () => {
    const page = read('app/page.tsx');
    const section = read('components/landing/WowyImpactSection.tsx');
    const demo = read('lib/landing/wowy-demo.ts');
    expect(page).toMatch(/WowyImpactSection/);
    expect(section).toMatch(/WowyResults/);
    expect(section).toMatch(/href="\/wowy"/);
    expect(section).toMatch(/Historical context only/);
    expect(section).toMatch(/not shared-court possessions/);
    expect(section).not.toMatch(/Start winning/i);
    expect(section).not.toMatch(/good bet/i);
    expect(demo).toMatch(/classifyWowyGames/);
    expect(demo).toMatch(/summarizeWowyPair/);
    expect(demo).toMatch(/Illustration only/);
    expect(demo).not.toMatch(/will score/i);
    expect(demo).not.toMatch(/causes/i);
  });

  it('labels Parlay XRay landing preview as illustration and reuses real panels', () => {
    const page = read('app/page.tsx');
    const section = read('components/landing/LandingParlayXrayPreview.tsx');
    const demo = read('lib/landing/parlay-xray-demo.ts');
    expect(page).toMatch(/LandingParlayXrayPreview/);
    expect(section).toMatch(/illustration only/i);
    expect(section).toMatch(/Design preview — fictional layout data/);
    expect(section).toMatch(/ExtractedLegsPanel/);
    expect(section).toMatch(/XrayAnalysisPanel/);
    expect(section).toMatch(/href="\/parlay-xray"/);
    expect(section).not.toMatch(/Start winning/i);
    expect(demo).toMatch(/Illustration only/);
    expect(demo).toMatch(/buildFullPreviewFixture/);
  });
});
