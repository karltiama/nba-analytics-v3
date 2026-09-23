import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography foundation', () => {
  const css = read('app/globals.css');
  const hero = read('components/landing/LandingHero.tsx');
  const layout = read('app/layout.tsx');

  it('defines the product type roles and the passing secondary ink', () => {
    expect(css).toMatch(/--color-cc-secondary:\s*#4a6366/);
    expect(css).toMatch(/--cc-secondary:\s*#4a6366/);
    expect(css).toMatch(/@utility type-page-title[\s\S]*font-size:\s*28px[\s\S]*line-height:\s*36px[\s\S]*font-weight:\s*600/);
    expect(css).toMatch(/@utility type-section-heading[\s\S]*font-size:\s*16px[\s\S]*line-height:\s*24px[\s\S]*font-weight:\s*600/);
    expect(css).toMatch(/@utility type-body[\s\S]*font-size:\s*16px[\s\S]*line-height:\s*24px[\s\S]*font-weight:\s*400/);
    expect(css).toMatch(/@utility type-card-data[\s\S]*font-size:\s*16px[\s\S]*line-height:\s*24px[\s\S]*font-weight:\s*600/);
    expect(css).toMatch(/@utility type-table-data[\s\S]*font-size:\s*14px[\s\S]*line-height:\s*20px[\s\S]*font-weight:\s*500/);
    expect(css).toMatch(/@utility type-secondary[\s\S]*font-size:\s*14px[\s\S]*line-height:\s*20px[\s\S]*font-weight:\s*400[\s\S]*var\(--cc-secondary\)/);
    expect(css).toMatch(/@utility type-metadata[\s\S]*font-size:\s*12px[\s\S]*line-height:\s*16px[\s\S]*font-weight:\s*500[\s\S]*var\(--cc-secondary\)/);
    expect(css).toMatch(/@utility type-interactive[\s\S]*font-size:\s*14px[\s\S]*line-height:\s*20px[\s\S]*font-weight:\s*600/);
    expect(css).toMatch(/@utility type-badge[\s\S]*font-size:\s*12px[\s\S]*line-height:\s*16px[\s\S]*font-weight:\s*600[\s\S]*text-transform:\s*none/);
  });

  it('does not change the root size, the font, or the marketing hero', () => {
    expect(css).not.toMatch(/html\s*\{[^}]*font-size/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-barlow-condensed\)/);
    expect(css).toMatch(/--font-display:\s*var\(--font-barlow-condensed\)/);
    expect(layout).toMatch(/Barlow_Condensed/);
    expect(layout).not.toMatch(/type-page-title/);
    expect(hero).toMatch(/text-5xl/);
    expect(hero).toMatch(/font-extrabold/);
    expect(hero).not.toMatch(/type-page-title|type-body|type-card-data/);
  });
});
