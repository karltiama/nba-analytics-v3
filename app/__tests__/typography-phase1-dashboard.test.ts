import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('dashboard typography phase 1', () => {
  const page = read('app/dashboard/page.tsx');
  const card = read('components/betting/GameCard.tsx');
  const probability = read('components/betting/MarketProbability.tsx');
  const strip = read('components/betting/TrendingPlayerStrip.tsx');
  const filters = read('components/betting/FilterBar.tsx');
  const insights = read('components/betting/AIInsightPanel.tsx');
  const header = read('components/betting/Header.tsx');

  it('gives the dashboard section and empty copy semantic roles', () => {
    expect(page).toContain('type-section-heading');
    expect(page).toContain('type-body');
    expect(page).toContain('type-metadata');
    expect(page).toContain('type-interactive');
  });

  it('keeps GameCard primary values on the card role and off failing gray', () => {
    expect(card).toContain('type-card-data');
    expect(card).toContain('type-badge');
    expect(card).not.toContain('text-[9px]');
    expect(card).not.toContain('text-[10px]');
    expect(card).not.toContain('#72869A');
    expect(card).not.toContain('#8aa0a3');
    expect(card).toContain('FAV');
    expect(probability).toContain('type-card-data');
    expect(probability).not.toContain('#72869A');
    expect(probability).not.toContain('text-[10px]');
  });

  it('uses semantic metadata on the trending strip and readable inactive tabs', () => {
    expect(strip).toContain('type-metadata');
    expect(strip).toContain('type-interactive');
    expect(strip).toContain('text-cc-secondary');
    expect(strip).not.toContain('text-[9px]');
    expect(strip).not.toContain('text-[10px]');
    expect(strip).not.toContain('#8aa0a3');
    expect(strip).not.toContain('#72869A');
  });

  it('keeps the FilterBar placeholder on the passing secondary ink', () => {
    expect(filters).toContain('placeholder:text-[#4a6366]');
    expect(filters).toContain('type-interactive');
    expect(filters).not.toContain('#8aa0a3');
    expect(filters).not.toContain('text-xs');
  });

  it('styles the account timezone as metadata without a full header restyle', () => {
    expect(header).toContain('type-metadata');
    expect(header).toContain('TZ:');
    expect(header).not.toContain('text-[#8aa0a3]');
  });

  it('gives the insight panel body and metadata roles', () => {
    expect(insights).toContain('type-section-heading');
    expect(insights).toContain('type-body');
    expect(insights).toContain('type-metadata');
    expect(insights).not.toContain('text-[10px]');
    expect(insights).not.toContain('#8aa0a3');
  });
});
