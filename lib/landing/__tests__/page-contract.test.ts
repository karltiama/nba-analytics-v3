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
});
