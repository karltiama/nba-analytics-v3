import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

describe('missed-shot 404 page', () => {
  it('is registered as the App Router not-found page', () => {
    const src = readFileSync(join(ROOT, 'app/not-found.tsx'), 'utf8');
    expect(src).toMatch(/MissedShot404/);
    expect(src).toMatch(/chrome="marketing"/);
  });

  it('keeps the designed copy and real destinations', () => {
    const src = readFileSync(join(ROOT, 'components/landing/MissedShot404.tsx'), 'utf8');
    expect(src).toMatch(/missed the shot/);
    expect(src).toMatch(/href="\/"/);
    expect(src).toMatch(/href="\/betting"/);
    expect(src).toMatch(/hero-court-right\.png/);
    expect(src).not.toMatch(/MissedShotIllustration/);
    expect(src).not.toMatch(/hero-court-right\.svg/);
  });
});
