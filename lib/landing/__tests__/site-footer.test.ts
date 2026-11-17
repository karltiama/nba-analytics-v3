import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('SiteFooter', () => {
  const src = read('components/layout/SiteFooter.tsx');
  // Rendered JSX only, so the doc comment's "no edge" note does not trip the claim check.
  const text = src.slice(src.indexOf('return (')).replace(/\s+/g, ' ');

  it('carries the approved responsible-gambling disclaimer', () => {
    expect(text).toMatch(/for research and entertainment only/);
    expect(text).toMatch(/not betting, financial or investment advice/);
    expect(text).toMatch(/nothing here guarantees winnings or profit/);
    expect(text).toMatch(/not a sportsbook and does not accept wagers/);
    expect(text).toMatch(/21\+ in most US states/);
    expect(src).toMatch(/1-800-GAMBLER/);
    expect(src).toMatch(/tel:18004262537/);
    expect(src).toMatch(/https:\/\/www\.ncpgambling\.org/);
  });

  it('has attribution, copyright and the developer link', () => {
    expect(src).toMatch(/Stats and odds data from BallDontLie/);
    expect(src).toMatch(/Not affiliated with or endorsed by the NBA/);
    expect(src).toMatch(/© \{year\} Court Context/);
    expect(src).toMatch(/https:\/\/www\.karltiama\.dev/);
  });

  it('makes no edge or winning-pick claims', () => {
    expect(text).not.toMatch(/\bedge\b|\block\b|guaranteed win|sure thing|winning picks/i);
  });

  it('renders on the landing page, the marketing 404 and the app shell', () => {
    for (const path of [
      'app/page.tsx',
      'components/landing/MissedShot404.tsx',
      'components/betting/BettingAppShell.tsx',
    ]) {
      expect(read(path), path).toMatch(/<SiteFooter \/>/);
      expect(read(path), path).not.toMatch(/<footer/);
    }
  });
});
